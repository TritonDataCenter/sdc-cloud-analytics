/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * tst.cainstr.js: tests the CA instrumenter backend.
 */

var mod_assert = require('assert');
var mod_metric = require('../../lib/ca/ca-metric');
var mod_tl = require('../../lib/tst/ca-test');
var cabe = require('../../cmd/cainst/modules/cainstr');

var metadata = new mod_metric.caMetricMetadata();

metadata.addFromHost({
	modules: { ca: { label: 'CA' } },
	types: { number: { arity: 'numeric' } },
	fields: {
		cabackend:	{ label: 'backend' },
		caid:		{ label: 'id' },
		cametric:	{ label: 'metric' },
		hostname:	{ label: 'hostname' },
		latency:	{ label: 'latency', type: 'number' },
		subsecond:	{ label: 'subsecond', type: 'number' }
	},
	metrics: [ {
		module: 'ca',
		stat: 'instr_ticks',
		label: 'ticks',
		unit: 'ticks',
		fields: [ 'hostname', 'latency', 'subsecond' ]
	}, {
		module: 'ca',
		stat: 'instr_beops',
		label: 'ops',
		unit: 'ops',
		fields: [ 'hostname', 'cabackend', 'caid', 'cametric',
		    'latency', 'subsecond' ]
	} ]
}, 'in-core');

mod_assert.deepEqual(metadata.problems(), []);
var instrbei = new mod_tl.caFakeInstrBackendInterface(metadata);

var impls = {};

instrbei.registerMetric = function (metr)
{
	var name = metr['module'] + '.' + metr['stat'];
	mod_assert.ok(!(name in impls));
	impls[name] = metr;
};

cabe.insinit(instrbei, mod_tl.ctStdout, test);

function test()
{
	mod_assert.ok('ca.instr_ticks' in impls);
	mod_assert.ok('ca.instr_beops' in impls);

	/*
	 * Since all of the metrics work the same way and use other components
	 * in the instrumenter framework, we only test one of them exhaustively
	 * and we don't bother building it up from simpler cases.
	 */
	var metric, instn, value, instd;

	metric = {
		is_module: 'ca',
		is_stat: 'instr_beops',
		is_predicate: { eq: [ 'cabackend', 'dtrace' ] },
		is_decomposition: [ 'caid', 'subsecond' ],
		is_granularity: 1
	};

	instn = impls['ca.instr_beops']['impl'](metric);
	instd = false;
	instn.instrument(function () { instd = true; });
	mod_assert.ok(instd);

	/* initial value: zero */
	instn.value(function (val) { value = val; });
	mod_assert.deepEqual(value, {});

	/* next value: zero again */
	instn.value(function (val) { value = val; });
	mod_assert.deepEqual(value, {});

	/* valid data point */
	instrbei.emit('instr_backend_op', { fields: {
	    hostname: 'foo',
	    cabackend: 'dtrace',
	    caid: '1457',
	    cametric: 'syscall.syscalls',
	    latency: 1357000,
	    subsecond: 235
	} });

	/* ignored: excluded by predicate */
	instrbei.emit('instr_backend_op', { fields: {
	    hostname: 'foo',
	    cabackend: 'kstat',
	    caid: '1200',
	    cametric: 'fs.logical_ops',
	    latency: 2827000,
	    subsecond: 429
	} });

	/* valid data point */
	instrbei.emit('instr_backend_op', { fields: {
	    hostname: 'foo',
	    cabackend: 'dtrace',
	    caid: '1312',
	    cametric: 'mysql.commands',
	    latency: 2123000,
	    subsecond: 486
	} });

	/* valid data point */
	instrbei.emit('instr_backend_op', { fields: {
	    hostname: 'foo',
	    cabackend: 'dtrace',
	    caid: '1457',
	    cametric: 'syscall.syscalls',
	    latency: 1200000,
	    subsecond: 287
	} });

	/* ignored: different event */
	instrbei.emit('instr_ticks', { fields: {
	    hostname: 'foo',
	    cabackend: 'kstat',
	    caid: '1200',
	    cametric: 'fs.logical_ops',
	    latency: 2827000,
	    subsecond: 429
	} });

	instn.value(function (val) { value = val; });
	mod_assert.deepEqual(value, {
		'1457': [ [[230, 239], 1], [[280, 289], 1] ],
		'1312': [ [[480, 489], 1] ]
	});

	instn.value(function (val) { value = val; });
	mod_assert.deepEqual(value, {});

	instn.deinstrument(function () { instd = false; });
	mod_assert.ok(!instd);
	mod_tl.ctStdout.info('test finished');
}
