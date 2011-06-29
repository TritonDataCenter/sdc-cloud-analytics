/*
 * Tests bucketization functions
 */

var mod_assert = require('assert');
var mod_instr = require('../../lib/ca/ca-instr');

var loglin, rv;

loglin = mod_instr.caInstrLogLinearBucketize(10, 0, 11, 100);
rv = [];

loglin(rv, 905, 10);
mod_assert.deepEqual(rv, [[[900, 909], 10]]);

loglin(rv, 902, 12);
mod_assert.deepEqual(rv, [[[900, 909], 22]]);

loglin(rv, 985, 13);
mod_assert.deepEqual(rv, [[[900, 909], 22], [[980, 989], 13]]);

loglin(rv, 1112, 14);
mod_assert.deepEqual(rv, [
    [[900, 909], 22],
    [[980, 989], 13],
    [[1100, 1190], 14]
]);

loglin(rv, 1012, 17);
mod_assert.deepEqual(rv, [
    [[900, 909], 22],
    [[980, 989], 13],
    [[1000, 1090], 17],
    [[1100, 1190], 14]
]);

/* edge cases */
rv = [];
loglin(rv, 1, 5);
mod_assert.deepEqual(rv, [[[1, 1.09], 5]]);

rv = [];
loglin(rv, 10, 5);
mod_assert.deepEqual(rv, [[[10, 10.9], 5]]);

rv = [];
loglin(rv, 100, 5);
mod_assert.deepEqual(rv, [[[100, 109], 5]]);

/* This one has tripped us up before. */
rv = [];
loglin(rv, 1000, 13);
mod_assert.deepEqual(rv, [[[1000, 1090], 13]]);
