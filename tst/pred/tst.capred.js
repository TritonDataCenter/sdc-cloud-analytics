/*
 * A test suite for ca-pred.js
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');
var mod_capred = require('../../lib/ca/ca-pred');

var pred, fields, ii, jj;

/*
 * Compares if two arrays are equivalent
 */
function compArrays(arr0, arr1)
{
	var found;

	mod_assert.equal(arr0.length, arr1.length);

	/*
	 * Because the lengths are equal we just have to verify each field in
	 * arr0 is present in arr1.
	 */
	for (ii = 0; ii < arr0.length; ii++) {
		found = false;
		for (jj = 0; jj < arr1.length; jj++) {
			try {
				mod_assert.deepEqual(arr0[ii], arr1[jj]);
				found = true;
			} catch (ex) {
				continue;
			}
		}

		mod_assert.ok(found);
	}
}

mod_assert.ok(!mod_capred.caPredNonTrivial({}));
mod_assert.ok(mod_capred.caPredNonTrivial({eq: ['zonename', 'bar']}));

/*
 * Test walking / caPredContainsField
 */
pred = { eq: [ 'zonename', 'foo' ] };
mod_assert.ok(mod_capred.caPredContainsField('zonename', pred));
mod_assert.ok(!mod_capred.caPredContainsField('hostname', pred));
pred = { and: [ { eq: [ 'zonename', 'foo' ] }, { ne: [ 'latency', 200 ] } ] };
mod_assert.ok(mod_capred.caPredContainsField('zonename', pred));
mod_assert.ok(!mod_capred.caPredContainsField('hostname', pred));

var obj = {
    zonename: 'zonename',
    latency: 'timestamp - now->ts'
};

mod_capred.caPredReplaceFields(obj, pred);
mod_assert.equal(mod_capred.caPredPrint(pred), '(zonename == "foo") && ' +
    '(timestamp - now->ts != 200)');

pred = { and: [ { eq: [ 'zonename', 'foo' ] }, { ne: [ 'latency', 200 ] } ] };
fields = mod_capred.caPredFields(pred);
compArrays(fields, [ 'zonename', 'latency' ]);
