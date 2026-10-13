const read = `
    console.log(JSON.stringify(await Effect.runPromise(database.use(db => db.query.packages.findMany({
      columns: {title: true, version: true},
      orderBy: {sourcePath: 'asc'},
      with: {
        aircraft: {
          columns: {sourceKey: true}, orderBy: {sourceKey: 'asc'},
          with: {package: {columns: {title: true}}, liveries: {columns: {sourceKey: true}}},
        },
        airports: {
          columns: {sourceKey: true}, orderBy: {sourceKey: 'asc'},
          with: {package: {columns: {title: true}}},
        },
        liveries: {
          columns: {sourceKey: true}, orderBy: {sourceKey: 'asc'},
          with: {
            package: {columns: {title: true}},
            aircraft: {columns: {sourceKey: true}, with: {package: {columns: {title: true}}}},
            airline: {columns: {icaoCode: true}},
          },
        },
      },
    }).sync()))));
    console.log(JSON.stringify(await Effect.runPromise(database.use(db => db.query.airlines.findMany({
      columns: {icaoCode: true}, orderBy: {icaoCode: 'asc'},
      with: {liveries: {columns: {sourceKey: true}, with: {package: {columns: {title: true}}}}},
    }).sync()))));
    console.log(await Effect.runPromise(database.use(db => db.query.liveries.findFirst({where: {sourceKey: 'missing'}}).sync())) === undefined);
`;

const removed = `
    console.log(JSON.stringify(await Effect.runPromise(database.use(db => db.query.liveries.findFirst({
      columns: {aircraftId: true, airlineId: true, targetAircraftKey: true},
      where: {sourceKey: 'external'},
      with: {aircraft: true, airline: true, package: {columns: {title: true}}},
    }).sync()))));
`;

const expected = [
  '[{"title":"First","version":"1","aircraft":[{"sourceKey":"plane-a","package":{"title":"First"},"liveries":[{"sourceKey":"external"}]},{"sourceKey":"plane-b","package":{"title":"First"},"liveries":[]}],"airports":[{"sourceKey":"airport-a","package":{"title":"First"}},{"sourceKey":"airport-b","package":{"title":"First"}}],"liveries":[{"sourceKey":"owned","package":{"title":"First"},"aircraft":null,"airline":null}]},{"title":"Second","version":null,"aircraft":[],"airports":[{"sourceKey":"airport-a","package":{"title":"Second"}}],"liveries":[{"sourceKey":"external","package":{"title":"Second"},"aircraft":{"sourceKey":"plane-a","package":{"title":"First"}},"airline":{"icaoCode":"EXA"}},{"sourceKey":"unresolved","package":{"title":"Second"},"aircraft":null,"airline":null}]}]',
  '[{"icaoCode":"EXA","liveries":[{"sourceKey":"external","package":{"title":"Second"}}]},{"icaoCode":"NONE","liveries":[]}]',
  'true',
  '{"aircraftId":null,"airlineId":null,"targetAircraftKey":"plane-a","aircraft":null,"airline":null,"package":{"title":"Second"}}',
  '',
].join('\n');

const relationsFixture = {expected, read, removed};

export default relationsFixture;
