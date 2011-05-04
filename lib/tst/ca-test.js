/*
 * testlib.js: A useful library for writing tests for cloud analytics
 */

var mod_sys = require('sys');
var mod_http = require('http');
var mod_path = require('path');
var mod_assert = require('assert');
var mod_querystring = require('querystring');

var mod_ca = require('../ca/ca-common');
var mod_cap = require('../ca/ca-amqp-cap');
var mod_log = require('../ca/ca-log');
var mod_persist = require('../ca/ca-svc-persist');
var HTTP = require('../ca/http-constants');

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
	var sysinfo, name, cap, vers, base, ii;

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
			base = mod_cap.ca_amqp_key_base_aggregator;
			break;
		case 'config':
			base = mod_cap.ca_amqp_key_base_config;
			break;
		case 'instrumenter':
			base = mod_cap.ca_amqp_key_base_instrumenter;
			break;
		default:
			base = 'ca.' + conf.type + '.';
			break;
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

	cap = new mod_cap.capAmqpCap({
		queue: base + sysinfo.ca_hostname,
		log: stdout,
		sysinfo: sysinfo,
		dbglog: stdout
	});

	for (ii = 0; ii < conf.bind.length; ii++)
		cap.bind(conf.bind[ii]);

	return (cap);
};

/*
 * Make an http request to a server on localhost.
 *
 * Required Arguments:
 *  - opts.method: a valid http method as a string
 *  - opts.path: The path you are requesting from the server
 *  - opts.port: The port to connect to the host on
 *  - callback: A function to callback to get the response from. The callback
 *  will be of the form function (err, response, data). If there is no data, it
 *  will be undefined.
 *
 * Optional Arguments:
 *  - opts.host: DNS name of system running server.  Default: localhost
 *  - opts.data: If defined this will be sent to the server.  Default: ''
 *  - opts.headers: The set of http headers.  Default: include transfer-encoding
 */
exports.ctHttpRequest = function (opts, callback)
{
	var client, request;
	var host = opts.host || 'localhost';
	var data = '';
	var headers = mod_ca.caDeepCopy(opts.headers) || {};

	if (!opts || !callback)
		throw (new Error('Missing required args'));

	if (!opts.method || !opts.path || !opts.port)
		throw (new Error('Missing required argument'));

	client = mod_http.createClient(opts.port, host);
	client.on('error', function (error) {
		callback(error, null, null);
	});
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
			callback(null, response, data);
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
	var func, name;

	cstate++;
	mod_assert.ok(cstate < exports.ctStates.length, 'Tried to ' +
		'advance but there are no more functions defined!');
	func = exports.ctStates[cstate];
	name = func.caFunctionName || func.name || '<anonymous>';
	exports.ctStdout.info('ADVANCING TO STAGE %d: %s', cstate, name);
	func.apply(null, arguments);
};

/*
 * Tests a condition, returning when we succeed. It tries again for a set number
 * of attempts waiting for a set time inbetween. To indicate failure, an
 * exception should be thrown.
 *
 * maxChecks: Number of checks
 * inbetween: Number of milliseconds to wait in between each call
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

/*
 * Initializes the configuration service (and persistence service) and waits for
 * them to finish starting.  For now, we don't actually start the config service
 * because the actual tests do that.
 */
exports.ctInitConfigService = function (callback)
{
	var persist, stages;

	persist = new mod_persist.caPersistenceService([ exports.ctTmpdir() ]);

	stages = [];

	stages.push(function (unused, next) { persist.start(next); });

	stages.push(function (unused, next) {
		exports.ctWaitForAmqpService(
		    mod_cap.ca_amqp_key_config, next);
	});

	stages.push(function (unused, next) {
		var func = arguments.callee.bind(unused, callback);

		exports.ctHttpRequest({
		    method: 'GET',
		    port: mod_ca.ca_http_port_config,
		    path: '/ca/instrumentations'
		}, function (err, response, data) {
			if (err)
				return (next(err));

			if (response.statusCode == HTTP.ESRVUNAVAIL)
				return (setTimeout(func, 500));

			return (next());
		});
	});

	caRunStages(stages, null, function (err) {
		if (err)
			throw (err);

		callback();
	});
};

/*
 * Repeatedly tries to ping the specified host on AMQP and invokes callback when
 * it gets a response.
 */
exports.ctWaitForAmqpService = function (routekey, callback)
{
	var cap, send, tid, tries, id;
	var pinged;

	id = exports.ctWaitForAmqpService.nextId++;
	pinged = false;

	cap = exports.ctCreateCap({
	    host: 'ctWaitForAmqpService' + id,
	    type: 'test',
	    bind: []
	});

	cap.on('connected', function () {
		cap.on('msg-ack-ping', function () {
			if (pinged)
				return;

			pinged = true;
			clearTimeout(tid);
			callback();
		});

		tries = 1;
		send = function () {
			tid = setTimeout(send, 1000);
			cap.sendCmdPing(routekey, tries++);
		};

		send();
	});

	cap.start();
};
exports.ctWaitForAmqpService.nextId = 0;

exports.ctWaitForHttpServer = function (server, port, callback)
{
	exports.ctTimedCheck(function (checkb) {
		exports.ctHttpRequest({
		    method: 'GET',
		    path: '/',
		    port: port
		}, checkb);
	}, callback, 30, 500);
};

function ctTmpdir()
{
	return (caSprintf('/var/tmp/%s.%s',
	    mod_path.basename(process.argv[1]), process.pid));
}

exports.ctTmpdir = ctTmpdir;

function ctDoExitSuccess()
{
	exports.ctStdout.info('ending test: ctDoExitSuccess invoked');
	exports.ctStdout.flush(function () { process.exit(0); });
}

exports.ctDoExitSuccess = ctDoExitSuccess;

/*
 * Dummy instrumenter service for use in test classes.
 */
function DummyInstrumenter(metrics)
{
	var dummy = this;
	var id = DummyInstrumenter.nextId++;

	this.di_log = exports.ctStdout;

	this.di_cap = exports.ctCreateCap({
	    host: 'test' + id,
	    type: 'instrumenter',
	    bind: [ mod_cap.ca_amqp_key_all ]
	});

	if (metrics)
		this.di_metrics = caDeepCopy(metrics);
	else
		this.di_metrics =  {
		    modules: {
			test_module: { label: 'test module description' }
		    },
		    types: {
			time: { arity: 'numeric' }
		    },
		    fields: {
			hostname: { label: 'server host name' },
			latency: { label: 'duration of op', type: 'time' }
		    },
		    metrics: [ {
			module: 'test_module',
			stat: 'ops1',
			label: 'test ops 1',
			type: 'time',
			fields: [ 'hostname', 'latency' ]
		    } ]
		};

	this.di_nenabled = 0;
	this.di_cap.on('msg-cmd-enable_instrumentation',
	    function (msg) { dummy.receiveEnable(msg); });
	this.di_cap.on('msg-notify-configsvc_online',
	    function (msg) { dummy.receiveConfigSvcOnline(msg); });
	/* XXX should handle status in a base class. */
}

exports.ctDummyInstrumenter = DummyInstrumenter;

DummyInstrumenter.nextId = 0;

/*
 * Start this dummy instrumenter.
 */
DummyInstrumenter.prototype.start = function (callback)
{
	var dummy = this;

	this.di_cap.on('connected', function () {
		dummy.notifyConfig();
		exports.ctWaitForAmqpService(
		    mod_cap.ca_amqp_key_config, callback);
	});

	this.di_cap.start();
};

/*
 * Handles the 'enable instrumentation' AMQP message.  This currently always
 * reports success but could be made to report failure by allowing the consumer
 * to specify a function to call when this message is received.
 */
DummyInstrumenter.prototype.receiveEnable = function (msg)
{
	this.di_nenabled++;
	this.di_cap.sendCmdAckEnableInstSuc(msg.ca_source, msg.ca_id,
	    msg.is_inst_id);
};

/*
 * Returns the number of instrumentations enabled on this instrumenter.
 */
DummyInstrumenter.prototype.nenabled = function ()
{
	return (this.di_nenabled);
};

/*
 * Handles the 'config service online' broadcast event by reporting our presence
 * to the new configuration service.
 */
DummyInstrumenter.prototype.receiveConfigSvcOnline = function (msg)
{
	this.notifyConfig();
};

/*
 * [private] Notifies the configuration service that we're online.
 */
DummyInstrumenter.prototype.notifyConfig = function (msg)
{
	this.di_cap.sendNotifyInstOnline(mod_cap.ca_amqp_key_config,
	    this.di_metrics);
};

/*
 * Like the DummyInstrumenter, this object lets tests instantiate an
 * AMQP-speaking aggregator that doesn't actually know how to aggregate data.
 */
function DummyAggregator()
{
	var dummy = this;
	var id = DummyAggregator.nextId++;

	this.da_log = exports.ctStdout;

	this.da_cap = exports.ctCreateCap({
	    host: 'test' + id,
	    type: 'aggregator',
	    bind: [ mod_cap.ca_amqp_key_all ]
	});

	this.da_cap.on('msg-cmd-enable_aggregation',
	    function (msg) { dummy.receiveEnable(msg); });
	this.da_cap.on('msg-notify-configsvc_online',
	    function (msg) { dummy.receiveConfigSvcOnline(msg); });
	/* XXX should handle status in a base class. */
}

exports.ctDummyAggregator = DummyAggregator;

DummyAggregator.nextId = 0;

DummyAggregator.prototype.start = function (callback)
{
	var dummy = this;

	this.da_cap.on('connected', function () {
		dummy.notifyConfig();
		exports.ctWaitForAmqpService(
		    mod_cap.ca_amqp_key_config, callback);
	});

	this.da_cap.start();
};

/*
 * Handles the 'enable aggregation' AMQP message.  This currently always reports
 * success but could be made to report failure by allowing the consumer to
 * specify a function to call when this message is received.
 */
DummyAggregator.prototype.receiveEnable = function (msg)
{
	this.da_cap.sendCmdAckEnableAggSuc(msg.ca_source, msg.ca_id,
	    msg.ag_inst_id);
};

/*
 * Handles the 'config service online' broadcast event by reporting our presence
 * to the new configuration service.
 */
DummyAggregator.prototype.receiveConfigSvcOnline = function (msg)
{
	this.notifyConfig();
};

/*
 * [private] Notifies the configuration service that we're online.
 */
DummyAggregator.prototype.notifyConfig = function (msg)
{
	this.da_cap.sendNotifyAggOnline(mod_cap.ca_amqp_key_config,
	    '127.0.0.1', '8080', {});
};

/*
 * Convenience class for making HTTP requests to Cloud Analytics services.  This
 * class provides methods for making requests using both form and JSON
 * encodings.  It also provides a mechanism for determining whether any requests
 * are outstanding, which is important in tests to know that the test is
 * complete.
 *
 * Each of the 'send' methods takes a 'fatal' parameter which causes the system
 * to bail out with an error if making the request fails.  Note that failure
 * here means we were unable to send an HTTP request and receive a response.
 * Receiving responses with 400- and 500-level error codes are not failures.
 *
 * The 'send' methods also take a 'callback' parameter which is invoked as
 * callback(err, response, rv).  'err' is the error making the request, if any.
 * This will always be null if 'fatal' is true because the callback won't be
 * invoked if there was an error.  'response' is the HTTP response object.
 * 'rv' is the response body, already JSON-decoded.  As a special case for
 * convenience, empty bodies are decoded as the empty string.
 */
function HttpRequester(port, host)
{
	this.hr_port = port;
	this.hr_host = host || 'localhost';
	this.hr_nrequests = 0;
	this.hr_log = exports.ctStdout;
}

exports.ctHttpRequester = HttpRequester;

/*
 * Sends a request with an empty body using the specified method and URI.
 */
HttpRequester.prototype.sendEmpty = function (method, uri, fatal, callback)
{
	this.sendRaw(method, uri, null, {}, fatal, callback);
};

/*
 * Sends a request with the specified method and URI and the specified
 * parameters transmitted in the body as an HTML form.
 */
HttpRequester.prototype.sendAsForm = function (method, uri, params, fatal,
    callback)
{
	var body, headers;

	body = mod_querystring.stringify(params);

	headers = {
	    'content-length': body.length,
	    'content-type': 'application/x-www-form-urlencoded'
	};

	mod_assert.ok(body);
	this.sendRaw(method, uri, body, headers, fatal, callback);
};

/*
 * Sends a request with the specified method and URI and the specified object
 * transmitted in the body using JSON.
 */
HttpRequester.prototype.sendAsJson = function (method, uri, obj, fatal,
    callback)
{
	var body, headers;

	body = JSON.stringify(obj);
	headers = {
	    'content-length': body.length,
	    'content-type': 'application/json'
	};

	this.sendRaw(method, uri, body, headers, fatal, callback);
};

/*
 * Sends a request with the specified method, URI, body, and headers.
 */
HttpRequester.prototype.sendRaw = function (method, uri, body, headers,
    fatal, callback)
{
	var fail, options;
	var requester = this;
	var log = this.hr_log;

	options = {
		method: method,
		path: uri,
		port: this.hr_port,
		host: this.hr_host,
		headers: headers
	};

	if (body) {
		mod_assert.ok(body.constructor == String);
		options.data = body;
	} else {
		body = '';
	}

	fail = function (err, rspdata) {
		log.error('HTTP request FAILED: %s %s, headers = %j, ' +
		    'body = %s; rspdata = %j: %r', method, uri,
		    headers, body, rspdata, err);

		if (!fatal)
			return (callback(err, null, null));

		log.error('bailing out because of failed request');
		process.exit(1);
		return (undefined);
	};

	this.hr_nrequests++;
	exports.ctHttpRequest(options, function (err, response, rspdata) {
		var json;

		--requester.hr_nrequests;

		if (err)
			return (fail(err, undefined));

		/*
		 * Some requests return no content.  To use the same code flow,
		 * we pretend they have an empty JSON string.
		 */
		if (rspdata === '')
			rspdata = '""';

		try {
			json = JSON.parse(rspdata);
		} catch (ex) {
			return (fail(ex, rspdata));
		}

		log.info('HTTP request SUCCEEDED: %s %s, headers = %j, ' +
		    'body = %s, code = %d, rspdata = %j', method, uri,
		    headers, body, response.statusCode, json);
		return (callback(null, response, json));
	});
};

HttpRequester.prototype.hasPendingRequests = function ()
{
	mod_assert.ok(this.hr_nrequests >= 0);
	return (this.hr_nrequests > 0);
};
