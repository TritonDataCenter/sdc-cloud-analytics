/*
 * testlib.js: A useful library for writing tests for cloud analytics
 */

var mod_sys = require('sys');
var mod_http = require('http');
var mod_assert = require('assert');

var mod_ca = require('../ca/ca-common');
var mod_caamqp = require('../ca/ca-amqp');
var mod_cap = require('../ca/ca-amqp-cap');
var mod_log = require('../ca/ca-log');

/*
 * Create logging functionality to standard out and standard error
 */
var stdout = new mod_log.caLog({ out: process.stdout });
exports.ctStdout = stdout;
exports.ctExitSuccess = 0;
exports.ctExitTimedOut = 127;

/*
 * This is our global state machine for testing.
 */
var cstate = -1;
exports.ctStates = [];

/*
 * Sets the amount of time we should wait before timing out the test as an
 * error.
 *
 * to is a time in milliseconds
 */
exports.ctSetTimeout = function (to)
{
	if (!to)
		throw (new Error('missing required timeout value'));

	setTimeout(function () {
		stdout.error(mod_ca.caSprintf('Test failed: Timedout after ' +
			'%d miliseconds', to));
		process.exit(exports.ctExitTimedOut);
	}, to);
};

/*
 * Creates a cap object described by conf.
 *
 * Required Arguments:
 *  - bind: An array of the different keys to listen on for AMQP
 *  - type: One of aggregator, instrumenter, config
 *
 * Optional Arguments:
 *  - name: The name of the service
 *  - vers: The version of the service
 *  - host: The hostname that we should use
 */
exports.ctCreateCap = function (conf)
{
	var sysinfo, name, amqp, cap, vers, base;

	if (!conf) {
		throw (new Error('Missing required configuration object'));
	}

	if (!conf.bind) {
		throw (new Error('Missing required bind argument'));
	}

	if (!conf.type) {
		throw (new Error('Missing required type arg'));
	}

	switch (conf.type) {
		case 'aggregator':
			base = mod_ca.ca_amqp_key_base_aggregator;
			break;
		case 'config':
			base = mod_ca.ca_amqp_key_base_config;
			break;
		case 'instrumenter':
			base = mod_ca.ca_amqp_key_base_instrumenter;
			break;
		default:
			throw (new Error('Unknown type'));
	}

	if ('vers' in conf)
		vers = conf.vers;
	else
		vers = '0.0.0';

	if ('name' in conf)
		name = conf.name;
	else
		name = 'fake-cap';

	sysinfo = mod_ca.caSysinfo(name, vers);

	if ('host' in conf)
		sysinfo.ca_hostname = conf.host;

	amqp = new mod_caamqp.caAmqp({
		broker: mod_ca.caBroker(),
		exchange: mod_ca.ca_amqp_exchange,
		exchange_opts: mod_ca.ca_amqp_exchange_opts,
		basename: base,
		hostname: sysinfo.ca_hostname,
		bindings: conf.bind
	});

	cap = new mod_cap.capAmqpCap({
		amqp: amqp,
		log: stdout,
		sysinfo: sysinfo,
		debug: true
	});

	return (cap);
};

/*
 * Make an http request to a server on localhost.
 *
 * Required Arguments:
 *  - opts.method: a valid http method as a string
 *  - opts.path: The path you are requesting from the server
 *  - opts.port: The port to connect to localhost on
 *  - callback: A function to callback to get the response from. The callback
 *  will be of the form function (response, data). If there is no data, it will
 *  be undefined.
 *
 * Optional Arguments:
 *  - opts.data: If defined this will be sent to the server
 *  - opts.headers: The set of http headers
 */
exports.ctHttpRequest = function (opts, callback)
{
	var client, request;
	var data = '';
	var headers = mod_ca.caDeepCopy(opts.headers) || {};

	if (!opts || !callback)
		throw (new Error('Missing required args'));

	if (!opts.method || !opts.path || !opts.port)
		throw (new Error('Missing required argument'));

	client = mod_http.createClient(opts.port, 'localhost');
	headers['transfer-encoding'] = 'chunked';
	request = client.request(opts.method, opts.path, headers);

	if (opts.data)
		request.write(opts.data);

	request.end();
	request.on('response', function (response) {
		response.on('data', function (chunk) {
			data = data + chunk;
		});
		response.on('end', function () {
			callback(response, data);
		});
	});
};

exports.ctGetQualId = mod_ca.caQualifiedId;

exports.ctPushFunc = function ()
{
	exports.ctStates.push.apply(exports.ctStates, arguments);
};

/*
 * Advances the internal state machine and dispatches the next function. Passes
 * around arguments as per apply.
 */
exports.advance = function ()
{
	cstate++;
	mod_assert.ok(cstate < exports.ctStates.length, 'Tried to ' +
		'advance but there are no more functions defined!');
	exports.ctStates[cstate].apply(null, arguments);
};

/*
 * Tests a condition, returning when we succeed. It tries again for a set number
 * of attempts waiting for a set time inbetween. To indicate failure, an
 * exception should be thrown.
 *
 * maxChecks: Number of checks
 * inbetween: Number of milliseconds to wait inbetween each call
 * cb: The callback to try and call
 * success: A function to run on success
 */
exports.ctTimedCheck = function (cb, success, maxChecks, inbetween)
{
	maxChecks--;
	stdout.info('calling cb');
	cb(function (err, result) {
		if (err === null) {
			success(result);
			return;
		}

		if (maxChecks === 0)
			throw (err);

		setTimeout(exports.ctTimedCheck, inbetween, cb, success,
		    maxChecks, inbetween);
	});
};
