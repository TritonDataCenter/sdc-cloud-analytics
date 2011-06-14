/*
 * tst.predicate.js: tests caInstrApplyPredicate
 */

var mod_assert = require('assert');
var mod_instr = require('../../lib/ca/ca-instr');

var points = [ {
    fields: { location: 'moe\'s bar', when: 'night', person: 'lurleen' },
    value: 100
}, {
    fields: { location: 'android\'s dungeon', when: 'day', person: 'stanky' },
    value: 12
}, {
    fields: { location: 'snpp', when: 'day', person: 'mindy' },
    value: 57
}, {
    fields: { location: 'detroit', when: 'night', person: 'herb' },
    value: 39
} ];

var result;

/*
 * always-true predicate
 */
result = mod_instr.caInstrApplyPredicate({}, points);
mod_assert.deepEqual(result, points);

/*
 * always-false predicate
 */
result = mod_instr.caInstrApplyPredicate({ eq: [ 'location', 'elementary' ] },
    points);
mod_assert.deepEqual(result, []);
mod_assert.equal(points.length, 4); /* original is unchnaged */

/*
 * simple condition
 */
result = mod_instr.caInstrApplyPredicate({ eq: [ 'when', 'night' ] }, points);
mod_assert.deepEqual(result, [ points[0], points[3] ]);

/*
 * more complex condition
 */
result = mod_instr.caInstrApplyPredicate({ or: [
    { eq: [ 'location', 'snpp' ] },
    { eq: [ 'person', 'lurleen' ] },
    { eq: [ 'person', 'mindy' ] }
] }, points);
mod_assert.deepEqual(result, [ points[0], points[2] ]);
