/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * This test is designed to test that the metrics we generate are syntactically
 * valid by DTrace and that all the valid combinations of decompositions and
 * potentially some predicates thrown in there.
 */

var mod_dtrace = require('libdtrace');
var mod_ca = require('../../lib/ca/ca-common');
var mod_cametad = require('../../lib/ca/ca-metad');
var mod_fs = require('fs');
var mod_assert = require('assert');
var mod_tl = require('../../lib/tst/ca-test');
var ASSERT = mod_assert.ok;

var dtrace_file_path = '../../cmd/cainst/modules/dtrace';

/*
 * We add zerodefs just to make sure we are mimicing what we are doing in
 * cmd/cainst/modules/dtrace.js. We don't want to actually do much more than
 * strcompile, otherwise we pratically hose VMware.
 */
function testCombo(desc, metric)
{
	var dtc, ii;
	var sep = '------------------------------------------';
	var res = mod_cametad.mdGenerateDScript(desc, metric);
	for (ii = 0; ii < res['scripts'].length; ii++) {
		try {
			dtc = new mod_dtrace.Consumer();
			dtc.setopt('zdefs');
			dtc.strcompile(res['scripts'][ii]);
			dtc = null;
		} catch (e) {
			mod_tl.ctStdout.error(caSprintf('Failed to compile ' +
			    'script:\n%s\n%s\n%s',
			    sep, res['scripts'][ii], sep));
			mod_tl.ctStout.error(caSprintf('Error is %r', e));
			process.exit(1);
		}
	}
	delete (res);
}

function generateCombos(base, fields)
{
	var key, ii, jj, metric, pred, length;
	var ret = [];
	var discrete = [];
	var numeric = [];

	ret.push(base);

	for (key in fields) {
		if ('internal' in fields[key])
			continue;

		switch (mod_ca.caTypeToArity(fields[key]['type'])) {
		case mod_ca.ca_arity_discrete:
			discrete.push(key);
			break;
		case mod_ca.ca_arity_numeric:
			numeric.push(key);
			break;
		default:
			ASSERT(false, 'programmer error');
			break;
		}
	}

	/* Push all singletons */
	for (ii = 0; ii < discrete.length; ii++) {
		metric = caDeepCopy(base);
		metric['is_decomposition'] = [ discrete[ii] ];
		ret.push(metric);
	}

	for (ii = 0; ii < numeric.length; ii++) {
		metric = caDeepCopy(base);
		metric['is_decomposition'] = [ numeric[ii] ];
		ret.push(metric);
	}

	/*
	 * Push on all discrete, numeric then all numeric,discrete. These
	 * shouldn't be different, but you never know what sublte errors are
	 * lying in the waste land
	 */
	for (ii = 0; ii < discrete.length; ii++) {
		for (jj = 0; jj < numeric.length; jj++) {
			metric = caDeepCopy(base);
			metric['is_decomposition'] =
			    [ discrete[ii], numeric[jj] ];
			ret.push(metric);
			metric = caDeepCopy(base);
			metric['is_decomposition'] =
			    [ numeric[jj], discrete[ii] ];
			ret.push(metric);
		}
	}

	/*
	 * Let's take everything we just did and add a predicate that is an and
	 * of every field
	 */
	pred = { or: [] };
	for (ii = 0; ii < discrete.length; ii++)
		pred['or'].push({ ne: [ discrete[ii], 'foobar' ] });
	for (ii = 0; ii < numeric.length; ii++)
		pred['or'].push({ ne: [ numeric[ii], 23 ] });

	length = ret.length; /* Make sure we don't kill ourselves */
	for (ii = 0; ii < length; ii++) {
		metric = caDeepCopy(ret[ii]);
		metric['is_predicate'] = caDeepCopy(pred);
		ret.push(metric);
	}

	return (ret);
}

/*
 * Validates basic properties of the metric and schedules the running of all the
 * necessary tests.
 */
function runMetricTest(desc)
{
	var key, basemetric, metrics, ii;

	mod_tl.ctStdout.info(caSprintf('Looking at metric description: %j',
	    desc));
	ASSERT('module' in desc, 'missing metric module declaration');
	ASSERT('stat' in desc, 'missing metric ops declaration');
	ASSERT('label' in desc, 'missing metric label declaration');
	ASSERT('type' in desc, 'missing metric type declaration');
	ASSERT(typeof (desc['module']) == typeof (''),
	    'module name must be a string');
	ASSERT(typeof (desc['stat']) == typeof (''),
	    'stat name must be a string');
	ASSERT(typeof (desc['label']) == typeof (''),
	    'label must be a string');
	ASSERT(typeof (desc['type']) == typeof (''),
	    'typemust be a string');

	ASSERT('fields' in desc, 'missing fields declaration');
	for (key in desc['fields']) {
		ASSERT(typeof (desc['fields'][key]) == typeof ({}),
		    'keys in fields must be objects: ' + key);
		if ('internal' in desc['fields'][key])
			continue;

		ASSERT('label' in desc['fields'][key],
		    'fields objects must have a label: ' + key);
		ASSERT(typeof (desc['fields'][key]['label']) == typeof (''),
		    'label must be a string in fields with key: ' + key);
		ASSERT('type' in desc['fields'][key],
		    'fields objects must have a type: ' + key);
		ASSERT(typeof (desc['fields'][key]['type']) == typeof (''),
		    'type must be a string in fields with key: ' + key);
		mod_assert.doesNotThrow(function () {
		    mod_ca.caTypeToArity(desc['fields'][key]['type']);
		});
	}

	ASSERT('metad' in desc, 'missing metad declaration');
	mod_cametad.mdValidateMetaD(desc);

	basemetric = {
	    is_module: desc['module'],
	    is_stat: desc['stat'],
	    is_predicate: {},
	    is_decomposition: []
	};

	metrics = generateCombos(basemetric, desc['fields']);

	for (ii = 0; ii < metrics.length; ii++) {
		mod_tl.ctStdout.info(caSprintf('testing combination: %j',
		    metrics[ii]));
		testCombo(desc, metrics[ii]);
	}

	delete (metrics);
}

/*
 * The heart of the battery of tests, this starts the world
 */
function test()
{
	var ii, mod;
	var files = mod_fs.readdirSync(dtrace_file_path);
	for (ii = 0; ii < files.length; ii++) {
		if (files[ii].substring(files[ii].length - 3,
		    files[ii].length) != '.js')
			continue;
		mod = require(caSprintf('%s/%s', dtrace_file_path, files[ii]));
		ASSERT('desc' in mod, 'file missing required description: ' +
		    files[ii]);
		runMetricTest(mod.desc);
	}
}

test();
