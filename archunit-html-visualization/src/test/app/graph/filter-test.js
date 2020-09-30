'use strict';

const chai = require('chai');
require('./testinfrastructure/filter-chai-extensions');
const {buildFilterCollection, buildFilterGroup} = require('../../../main/app/graph/filter');

const expect = chai.expect;

const getNumbersCollection = maximumNumber => {
  const numbers = [...Array(maximumNumber + 1).keys()].map(n => ({value: n, matchesFilter: new Map()}));
  const res = {
    numbers,
    filteredNumbers: numbers,
    runFilter: (filter, key) => numbers.forEach(n => n.matchesFilter.set(key, filter(n))),

    applyFilters: () => res.filteredNumbers = res.numbers.filter(n => [...n.matchesFilter.values()].every(f => f))
  };
  return res;
};

const range = (from, to) => [...Array(to - from + 1).keys()].map(n => from + n);

describe('filters', () => {
  it('does initialize all filters with true', () => {
    const collection = getNumbersCollection(30);
    const filterGroup = buildFilterGroup('group', collection)
      .addDynamicFilter('boundsFilter', () => false, [], true)
      .withStaticFilterPrecondition(true)
      .build();
    buildFilterCollection()
      .addFilterGroup(filterGroup)
      .build();

    expect(collection.numbers.map(n => n.matchesFilter.get('boundsFilter')).every(v => v)).to.be.true;
  });

  it('can apply single static filter with static precondition', () => {
    const collection = getNumbersCollection(30);
    const filterGroup = buildFilterGroup('group', collection)
      .addDynamicFilter('boundsFilter', n => n.value >= 10 && n.value <= 20, [], true)
      .withStaticFilterPrecondition(false)
      .build();
    const filter = buildFilterCollection()
      .addFilterGroup(filterGroup)
      .build();

    filter.updateFilter('group.boundsFilter');

    expect(collection.filteredNumbers).to.containNumbers(range(0, 30));

    filter.getFilter('group.boundsFilter').filterPrecondition.filterIsEnabled = true;
    filter.updateFilter('group.boundsFilter');

    expect(collection.filteredNumbers).to.containNumbers(range(10, 20));
  });

  it('can apply single static filter with dynamic precondition', () => {
    const collection = getNumbersCollection(30);
    let filterIsEnabled = false;
    const filterGroup = buildFilterGroup('group', collection)
      .addDynamicFilter('boundsFilter', n => n.value >= 10 && n.value <= 20, [], true)
      .withDynamicFilterPrecondition(() => filterIsEnabled)
      .build();
    const filter = buildFilterCollection()
      .addFilterGroup(filterGroup)
      .build();

    filter.updateFilter('group.boundsFilter');

    expect(collection.filteredNumbers).to.containNumbers(range(0, 30));

    filterIsEnabled = true;
    filter.updateFilter('group.boundsFilter');

    expect(collection.filteredNumbers).to.containNumbers(range(10, 20));
  });

  it('can apply single dynamic filter with static precondition', () => {
    const collection = getNumbersCollection(30);
    let filterFun = () => true;

    const filterGroup = buildFilterGroup('group', collection)
      .addDynamicFilter('boundsFilter', () => filterFun, [])
      .withStaticFilterPrecondition(true)
      .build();
    const filter = buildFilterCollection()
      .addFilterGroup(filterGroup)
      .build();

    filter.updateFilter('group.boundsFilter');

    expect(collection.filteredNumbers).to.containNumbers(range(0, 30));

    filterFun = n => n.value >= 10 && n.value <= 20;
    filter.updateFilter('group.boundsFilter');

    expect(collection.filteredNumbers).to.containNumbers(range(10, 20));
  });

  it('can apply several filters without dependencies to one group', () => {
    const collection = getNumbersCollection(30);

    const filterGroup = buildFilterGroup('group', collection)
      .addDynamicFilter('dividableByTwo', n => n.value % 2 === 0, [], true)
      .withStaticFilterPrecondition(true)
      .addDynamicFilter('dividableByThree', n => n.value % 3 === 0, [], true)
      .withStaticFilterPrecondition(true)
      .addDynamicFilter('biggerThan10', n => n.value >= 10, [], true)
      .withStaticFilterPrecondition(false)
      .build();
    const filter = buildFilterCollection()
      .addFilterGroup(filterGroup)
      .build();

    filter.updateFilter('group.dividableByTwo');
    filter.updateFilter('group.dividableByThree');

    expect(collection.filteredNumbers).to.containNumbers([0, 6, 12, 18, 24, 30]);

    filter.getFilter('group.biggerThan10').filterPrecondition.filterIsEnabled = true;

    filter.updateFilter('group.biggerThan10');

    expect(collection.filteredNumbers).to.containNumbers([12, 18, 24, 30]);
  });

  it('can apply several filters with dependencies to one group', () => {
    const collection = getNumbersCollection(100);

    const filterGroup = buildFilterGroup('group', collection)
      .addDynamicFilter('dividableByThree', n => n.value % 3 === 0, ['group.squareOfThreeDividable'], true)
      .withStaticFilterPrecondition(true)
      .addDynamicFilter('squareOfThreeDividable', n => collection.numbers.filter(c => c.matchesFilter.get('dividableByThree')).some(c => n.value === c.value * c.value), [], true)
      .withStaticFilterPrecondition(true)
      .build();
    const filter = buildFilterCollection()
      .addFilterGroup(filterGroup)
      .build();

    filter.updateFilter('group.dividableByThree');

    expect(collection.filteredNumbers).to.containNumbers([0, 9, 36, 81]);
  });

  it('can apply several filters with dependencies to two groups', () => {
    const collection1 = getNumbersCollection(100);
    const collection2 = getNumbersCollection(100);

    const filterGroup1 = buildFilterGroup('group1', collection1)
      .addDynamicFilter('someFilter', () => false, [], true)
      .withStaticFilterPrecondition(true)
      .addDynamicFilter('squareOfThreeDividable', n => collection1.numbers.filter(c => c.matchesFilter.get('dividableByThree')).some(c => n.value === c.value * c.value), ['group2.sumOfTwoThreeSquares'], true)
      .withStaticFilterPrecondition(true)
      .addDynamicFilter('dividableByThree', n => n.value % 3 === 0 && n.matchesFilter.get('someFilter'), ['group1.squareOfThreeDividable'], true)
      .withStaticFilterPrecondition(true)
      .build();
    const filterGroup2 = buildFilterGroup('group2', collection2)
      .addDynamicFilter('sumOfTwoThreeSquares', n => {
        const filtered = collection1.numbers.filter(c => c.matchesFilter.get('squareOfThreeDividable'));
        return filtered.some(s1 => filtered.some(s2 => n.value === s1.value + s2.value));
      }, [], true)
      .withStaticFilterPrecondition(true)
      .build();
    const filter = buildFilterCollection()
      .addFilterGroup(filterGroup1)
      .addFilterGroup(filterGroup2)
      .build();

    filter.updateFilter('group1.dividableByThree');

    expect(collection1.filteredNumbers).to.containNumbers([0, 9, 36, 81]);
    expect(collection2.filteredNumbers).to.containNumbers([0, 9, 18, 36, 45, 72, 81, 90]);
  });
});
