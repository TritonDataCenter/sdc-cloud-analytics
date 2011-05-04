/*
 * In this test we throw lots of bad HTTP requets/parameters to the Config
 * service and expect to get back failures.
 */
var mod_assert = require('assert');
var mod_tl = require('../../lib/tst/ca-test');
var mod_ca = require('../../lib/ca/ca-common');

var CFGSVC_PORT = mod_ca.ca_http_port_config;

var httpFail = function (errno, path)
{
	return (function (err, response) {
		if (err)
			throw (err);

		mod_assert.equal(response.statusCode, errno,
		    mod_ca.caSprintf('Tried to access path: %s.\nExpected ' +
			'return code %d, got %d.',
			path, errno, response.statusCode));

		checkdone();
	});
};

function checkdone()
{
	if (--nrequests === 0) {
		mod_tl.ctStdout.info('test completed successfully');
		process.exit(0);
	}
}

function runRequest(obj, errno)
{
	var func = httpFail(errno, obj.path);
	mod_tl.ctStdout.info('testing path "%s"', obj.path);
	mod_tl.ctHttpRequest(obj, func);
}

/*
 * Wait for the server to come up.
 */
var nrequests = 0;

mod_tl.ctSetTimeout(15 * 1000);
mod_tl.ctInitConfigService(runtests);

function runtests()
{
	/* Bad Paths */
	++nrequests;

	runRequest({
	    method: 'GET',
	    path: '/foobar/baz/blah',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca',
	    port: CFGSVC_PORT
	}, 200);

	runRequest({
	    method: 'GET',
	    path: '/ca/',
	    port: CFGSVC_PORT
	}, 200);

	runRequest({
	    method: 'GET',
	    path: '/ca/metric',
	    port: CFGSVC_PORT
	}, 404);

	/* Using missing customer ids */

	runRequest({
	    method: 'GET',
	    path: '/ca/customers//metrics',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers//instrumentations',
	    port: CFGSVC_PORT
	}, 404);

	/* Use paths we know that it shouldn't support */

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/1/instrumentation/1/value',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/1/instrumentation/1/value/raw',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/1/instrumentation/1/value/heatmap',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/instrumentation/1/value',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/instrumentation/1/value/raw',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/instrumentation/1/value/heatmap',
	    port: CFGSVC_PORT
	}, 404);

	/* Specify non-existant instrumentation ids */

	runRequest({
	    method: 'GET',
	    path: '/ca/instrumentations/foobar',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/instrumentations/bmc',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/instrumentations/dap',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/rm/instrumentations/23',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/brendan/instrumentations/42',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/instrumentations/foobar',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/instrumentations/bmc',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/instrumentations/dap',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/rm/instrumentations/23',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'GET',
	    path: '/ca/customers/brendan/instrumentations/42',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'DELETE',
	    path: '/ca/instrumentations/foobar',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'DELETE',
	    path: '/ca/instrumentations/bmc',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'DELETE',
	    path: '/ca/instrumentations/dap',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'DELETE',
	    path: '/ca/customers/rm/instrumentations/23',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'DELETE',
	    path: '/ca/customers/brendan/instrumentations/42',
	    port: CFGSVC_PORT
	}, 404);


	runRequest({
	    method: 'PUT',
	    path: '/ca/instrumentations/foobar',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'PUT',
	    path: '/ca/instrumentations/bmc',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'PUT',
	    path: '/ca/instrumentations/dap',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'PUT',
	    path: '/ca/customers/rm/instrumentations/23',
	    port: CFGSVC_PORT
	}, 404);

	runRequest({
	    method: 'PUT',
	    path: '/ca/customers/brendan/instrumentations/42',
	    port: CFGSVC_PORT
	}, 404);

	checkdone();
}
