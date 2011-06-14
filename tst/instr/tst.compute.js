/*
 * tst.compue.js: tests caInstrComputeValue
 */

var mod_assert = require('assert');
var mod_instr = require('../../lib/ca/ca-instr');
var mod_metric = require('../../lib/ca/ca-metric');

var points = [ {
    fields: { location: 'moe\'s bar', when: 'night', person: 'lurleen',
	temp: 55 },
    value: 100
}, {
    fields: { location: 'android\'s dungeon', when: 'day', person: 'stanky',
	temp: 102 },
    value: 12
}, {
    fields: { location: 'snpp', when: 'day', person: 'mindy', temp: 57 },
    value: 57
}, {
    fields: { location: 'detroit', when: 'night', person: 'herb', temp: 12 },
    value: 39
} ];

var metadata = new mod_metric.caMetricMetadata();
metadata.addFromHost({
	modules: {},
	types: { number: { arity: 'numeric' } },
	fields: {
		location:	{ label: 'location' },
		when:		{ label: 'when' },
		person:		{ label: 'person' },
		temp:		{ label: 'temperature', type: 'number' }
	},
	metrics: {}
}, 'in-core');

var bucketizers = { temp: mod_instr.caInstrLinearBucketize(10) };

var result;

/*
 * no decomposition
 */
result = mod_instr.caInstrComputeValue(metadata, bucketizers, [], points);
mod_assert.equal(result, 208);

/*
 * single discrete decompositions
 */
result = mod_instr.caInstrComputeValue(metadata, bucketizers, [ 'when' ],
    points);
mod_assert.deepEqual(result, { night: 139, day: 69 });

result = mod_instr.caInstrComputeValue(metadata, bucketizers, [ 'person' ],
    points);
mod_assert.deepEqual(result, {
    lurleen: 100,
    stanky: 12,
    mindy: 57,
    herb: 39
});

/*
 * single numeric decomposition
 */
result = mod_instr.caInstrComputeValue(metadata, bucketizers, [ 'temp' ],
    points);
mod_assert.deepEqual(result, [
    [[10, 19], 39],
    [[50, 59], 157],
    [[100, 109], 12]
]);

/*
 * combined decomposition
 */
result = mod_instr.caInstrComputeValue(metadata, bucketizers,
    [ 'when', 'temp' ], points);
mod_assert.deepEqual(result, {
    day: [
	[[50, 59], 57],
	[[100, 109], 12]
    ],
    night: [
	[[10, 19], 39],
	[[50, 59], 100]
    ]
});
