'use strict';

const {Vector, vectors} = require('../infrastructure/vectors');

const coloredDependencyTypes = new Set();
const dashedDependencyTypes = new Set();

const init = (View, DetailedView) => {

  const defaultDependencyTypes = {
    INNERCLASS_DEPENDENCY: 'INNERCLASS_DEPENDENCY'
  };

  const allDependencies = new Map();

  const oneEndNodeIsCompletelyWithinTheOtherOne = (node1, node2) => {
    const middleDiff = vectors.distance(node1, node2);
    return middleDiff + Math.min(node1.r, node2.r) < Math.max(node1.r, node2.r);
  };

  const VisualData = class {
    constructor(listener, dependency) {
      this._listener = listener;
      this._dependency = dependency;
      this.startPoint = {};
      this.endPoint = {};
      this.mustShareNodes = false;
    }

    jumpToPosition(absVisualStartNode, absVisualEndNode) {
      this._recalculate(absVisualStartNode, absVisualEndNode);
      this._listener.onJumpedToPosition();
    }

    moveToPosition(absVisualStartNode, absVisualEndNode) {
      this._recalculate(absVisualStartNode, absVisualEndNode);
      return this._listener.onMovedToPosition();
    }

    //FIXME: move to own file and make proper test for it...it is better to test all cases on its own
    _recalculate(absVisualStartNode, absVisualEndNode) {
      const lineDiff = 20;
      const oneIsInOther = oneEndNodeIsCompletelyWithinTheOtherOne(absVisualStartNode, absVisualEndNode);
      const nodes = [absVisualStartNode, absVisualEndNode].sort((a, b) => a.r - b.r);

      const direction = Vector.between(absVisualStartNode, absVisualEndNode);

      const startDirectionVector = Vector.from(direction);
      startDirectionVector.revertIf(oneIsInOther && absVisualStartNode === nodes[0]);
      startDirectionVector.makeDefaultIfNull();
      const endDirectionVector = Vector.from(startDirectionVector).revertIf(!oneIsInOther);

      if (this.mustShareNodes) {
        const orthogonalVector = vectors.getOrthogonalVector(startDirectionVector).norm(lineDiff / 2);
        orthogonalVector.revertIf(oneIsInOther && absVisualStartNode === nodes[1]);
        startDirectionVector.norm(absVisualStartNode.r);
        endDirectionVector.norm(absVisualEndNode.r);
        startDirectionVector.add(orthogonalVector);
        endDirectionVector.add(orthogonalVector);
      }

      startDirectionVector.norm(absVisualStartNode.r);
      endDirectionVector.norm(absVisualEndNode.r);

      this.startPoint = vectors.add(absVisualStartNode, startDirectionVector);
      this.endPoint = vectors.add(absVisualEndNode, endDirectionVector);

      this.recalculateRelativePoints();
    }

    recalculateRelativePoints() {
      this.relativeStartPoint = Vector.between(this._dependency.containerEndNode.absoluteFixableCircle, this.startPoint);
      this.relativeEndPoint = Vector.between(this._dependency.containerEndNode.absoluteFixableCircle, this.endPoint);
    }
  };

  const getOrCreateUniqueDependency = (originNode, targetNode, type, isViolation, callForAllDependencies, getDetailedDependencies,
                                       {svgDetailedDependenciesContainer, svg, svgCenterTranslater}) => {
    const key = `${originNode.getFullName()}-${targetNode.getFullName()}`;
    if (!allDependencies.has(key)) {
      allDependencies.set(key, new GroupedDependency(originNode, targetNode, type, isViolation, callForAllDependencies, getDetailedDependencies,
        {svgDetailedDependenciesContainer, svg, svgCenterTranslater}));
    }
    return allDependencies.get(key).withTypeAndViolation(type, isViolation)
  };

  const ElementaryDependency = class {
    constructor(originNode, targetNode, type, description, isViolation = false) {
      this._originNode = originNode;
      this._targetNode = targetNode;
      this.from = originNode.getFullName();
      this.to = targetNode.getFullName();
      this.type = type;
      this.description = description;
      this.isViolation = isViolation;
      this._matchesFilter = new Map();
    }

    get originNode() {
      return this._originNode;
    }

    get targetNode() {
      return this._targetNode;
    }

    setMatchesFilter(key, value) {
      this._matchesFilter.set(key, value);
    }

    matchesAllFilters() {
      return [...this._matchesFilter.values()].every(v => v);
    }

    matchesFilter(key) {
      return this._matchesFilter.get(key);
    }

    toString() {
      return this.description;
    }

    markAsViolation() {
      this.isViolation = true;
    }

    unMarkAsViolation() {
      this.isViolation = false;
    }
  };

  const joinStrings = (separator, ...stringArray) => stringArray.filter(element => element).join(separator);

  const argMax = (arr, firstIsGreaterThanSecond) => arr.reduce((elementWithMaxSoFar, e) => firstIsGreaterThanSecond(e, elementWithMaxSoFar) ? e : elementWithMaxSoFar, arr ? arr[0] : null);

  const GroupedDependency = class extends ElementaryDependency {
    constructor(originNode, targetNode, type, isViolation, callForAllDependencies, getDetailedDependencies, {svgDetailedDependenciesContainer, svg, svgCenterTranslater}) {
      super(originNode, targetNode, type, '', '', isViolation);
      this._containerEndNode = this.calcEndNodeInForeground();
      this._view = new View(this);

      this._detailedView = new DetailedView({svgContainer: svgDetailedDependenciesContainer, svg, svgCenterTranslater},
        callback => callForAllDependencies(dep => callback(dep._detailedView)),
        () => getDetailedDependencies(this.originNode.getFullName(), this.targetNode.getFullName()));
      this._view.onMouseOver(() => this._detailedView.fadeIn());
      this._view.onMouseOut(() => this._detailedView.fadeOut());

      this._isVisible = true;
      this.visualData = new VisualData({
        onJumpedToPosition: () => this._view.jumpToPositionAndShowIfVisible(),
        onMovedToPosition: () => this._view.moveToPosition().then(() => this.refresh())
      }, this);
      this._containerEndNodeHasChanged = false;
    }

    onContainerEndNodeApplied() {
      this._containerEndNodeHasChanged = false;
    }

    get containerEndNode() {
      return this._containerEndNode;
    }

    set containerEndNode(value) {
      if (this._containerEndNode !== value) {
        this._containerEndNodeHasChanged = true;
        this._containerEndNode = value;
        this.visualData.recalculateRelativePoints();
      }
    }

    onNodesFocused() {
      if (this._containerEndNodeHasChanged) {
        this._view.onContainerEndNodeChanged();
        this.jumpToPosition();
      }
    }

    withTypeAndViolation(type, isViolation) {
      this.type = type;
      this.isViolation = isViolation;
      return this;
    }

    calcEndNodeInForeground() {
      return argMax([this._originNode, this._targetNode], (node1, node2) => node1.liesInFrontOf(node2));
    }

    calcEndNodeInBackground() {
      return argMax([this._originNode, this._targetNode], (node1, node2) => !node1.liesInFrontOf(node2));
    }

    hasDetailedDescription() {
      return !(this.originNode.isPackage() || this.targetNode.isPackage());
    }

    jumpToPosition() {
      this.visualData.jumpToPosition(this.originNode.absoluteFixableCircle, this.targetNode.absoluteFixableCircle);
    }

    moveToPosition() {
      return this.visualData.moveToPosition(this.originNode.absoluteFixableCircle, this.targetNode.absoluteFixableCircle);
    }

    hide() {
      this._isVisible = false;
      this._view.refresh();
    }

    show() {
      this._isVisible = true;
      this._view.refresh();
    }

    isVisible() {
      return this._isVisible;
    }

    refresh() {
      if (this.originNode.overlapsWith(this.targetNode)) {
        this.hide();
      } else {
        this.show();
      }
    }

    toString() {
      return `${this.originNode.getFullName()}-${this.targetNode.getFullName()}`;
    }
  };

  const getSingleStyledDependencyType = (dependencies, styledDependencyTypes, mixedStyle) => {
    const currentDependencyTypes = new Set(dependencies.map(d => d.type));
    const currentStyledDependencyTypes = [...currentDependencyTypes].filter(t => styledDependencyTypes.has(t));
    if (currentStyledDependencyTypes.length === 0) {
      return '';
    } else if (currentStyledDependencyTypes.length === 1) {
      return currentStyledDependencyTypes[0];
    } else {
      return mixedStyle;
    }
  };

  const getUniqueDependency = (originNode, targetNode, callForAllDependencies, getDetailedDependencies,
                               {svgDetailedDependenciesContainer, svg, svgCenterTranslater}) => ({
    byGroupingDependencies: dependencies => {
      if (originNode.isPackage() || targetNode.isPackage()) {
        return getOrCreateUniqueDependency(originNode, targetNode, '', dependencies.some(d => d.isViolation),
          callForAllDependencies, getDetailedDependencies, {svgDetailedDependenciesContainer, svg, svgCenterTranslater});
      } else {
        const colorType = getSingleStyledDependencyType(dependencies, coloredDependencyTypes, 'severalColors');
        const dashedType = getSingleStyledDependencyType(dependencies, dashedDependencyTypes, 'severalDashed');

        return getOrCreateUniqueDependency(originNode, targetNode, joinStrings(' ', colorType, dashedType),
          dependencies.some(d => d.isViolation), callForAllDependencies, getDetailedDependencies,
          {svgDetailedDependenciesContainer, svg, svgCenterTranslater});
      }
    }
  });

  const shiftElementaryDependency = (dependency, newOriginNode, newTargetNode) => {
    return new ElementaryDependency(newOriginNode, newTargetNode, '', '', dependency.isViolation);
  };

  const createElementaryDependency = ({originNode, targetNode, type, description}) =>
    new ElementaryDependency(originNode, targetNode, type, description);

  return {
    createElementaryDependency,
    getUniqueDependency,
    shiftElementaryDependency,
    getDefaultDependencyTypes: () => [...Object.values(defaultDependencyTypes)]
  };
};

module.exports = init;