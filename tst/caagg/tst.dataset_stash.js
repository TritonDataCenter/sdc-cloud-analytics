/*
 * Tests stash/unstash specific behavior.  Much of this is tested by the
 * individual dataset implementation tests.
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');
var mod_caagg = require('../../lib/ca/ca-agg');
var mod_tl = require('../../lib/tst/ca-test');

var spec = {
    'value-arity': mod_ca.ca_arity_scalar,
    'value-dimension': 1,
    'value-scope': 'interval',
    'nsources': 2,
    'granularity': 1
};

var dataset = mod_caagg.caDatasetForInstrumentation(spec);
var stashed, restored;

var source1 = 'source1';
var source2 = 'source2';

var time1 = 12340;
var time2 = 12345;

/* stash / unstash */
stashed = dataset.stash();
restored = mod_caagg.caDatasetForInstrumentation(spec);

/* just don't throw an exception */
restored.unstash(stashed['metadata'], stashed['data']);

try {
	stashed['metadata'].ca_agg_stash_vers_major++;
	restored.unstash(stashed['metadata'], stashed['data']);
	mod_assert.ok(false, 'should have thrown ECA_INCOMPAT exception');
} catch (ex) {
	if (!(ex instanceof caError))
		throw (ex);

	mod_assert.equal(ECA_INCOMPAT, ex.code());
}

stashed['metadata'].ca_agg_stash_vers_major--;
stashed['metadata'].ca_agg_stash_vers_minor++;
restored.unstash(stashed['metadata'], stashed['data']); /* should work */
