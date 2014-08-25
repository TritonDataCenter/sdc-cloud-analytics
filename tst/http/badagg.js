/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * In this test we throw lots of bad HTTP requests/parameters to the aggregator
 * service and expect to get back failures.
 */

var mod_assert = require('assert');
var mod_tl = require('../../lib/tst/ca-test');
var mod_ca = require('../../lib/ca/ca-common');

var PORT = mod_ca.ca_http_port_agg_base;

var httpFail = function (errno, path)
{
	return (function (err, response) {
		if (err)
			throw (err);

		mod_assert.equal(response.statusCode, errno,
		    mod_ca.caSprintf('Tried to access path: %s.\nExpected ' +
			'return code %d, got %d.',
			path, errno, response.statusCode));
	});
};

function runRequest(obj, errno)
{
	var func = httpFail(errno, obj.path);
	mod_tl.ctHttpRequest(obj, func);
}

/*
 * Wait for the server to come up.
 */
mod_tl.ctWaitForHttpServer('localhost', PORT, runtests);

function runtests()
{
	/* Bad Paths */

	runRequest({
	    method: 'GET',
	    path: '/foobar/baz/blah',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/',
	    port: PORT
	}, 404);

	/* Use paths we know that it shouldn't support */

	runRequest({
	    method: 'GET',
	    path: '/ca/metrics',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/1/metrics',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/1/instrumentations',
	    port: PORT
	}, 404);

	/* Use paths with missing customer / inst ids */

	runRequest({
	    method: 'GET',
	    path: '/ca/customers//instrumentation/1/value',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers//instrumentation/1/value/raw',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers//instrumentation/1/value/heatmap',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers//instrumentation//value',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers//instrumentation//value/raw',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers//instrumentation//value/heatmap',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/1/instrumentation//value',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/1/instrumentation//value/raw',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/1/instrumentation//value/heatmap',
	    port: PORT
	}, 404);

	/* Specify non-existant instrumentation ids */

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/rm/instrumentation/1/value',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/bmc/instrumentation/1/value/raw',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/dap/instrumentation/1/value/heatmap',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/rm/instrumentation/brendan/value',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/bmc/instrumentation/brendan/value/raw',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/dap/instrumentation/brendan/value/heatmap',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/1/instrumentation/brendan/value',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/1/instrumentation/brendan/value/raw',
	    port: PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/1/instrumentation/brendan/value/heatmap',
	    port: PORT
	}, 404);
}
