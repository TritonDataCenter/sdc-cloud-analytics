/*
 * In this test we throw lots of bad HTTP requests/parameters to the aggregator
 * service and expect to get back failures.
 */

var mod_assert = require('assert');
var mod_tl = require('../../lib/tst/ca-test');
var mod_ca = require('../../lib/ca/ca-common');

var PORT = 23182;

var httpFail = function (errno, path)
{
	return (function (response) {
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
