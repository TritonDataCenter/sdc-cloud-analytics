/*
 * ca.js: Cloud Analytics system constants and common routines.
 */

var ASSERT = require('assert');
var mod_sys = require('sys');
var mod_uname = require('uname');

/*
 * We use only one global exchange of type 'topic'.
 */
exports.ca_amqp_exchange 		= 'amq.topic';
exports.ca_amqp_exchange_opts		= { type: 'topic' };

/*
 * If someone has specified the CA_AMQP_PREFIX, we should use that in the
 * construction of all of our amqp routing keys.
 */
var amqp_prefix = '';
if (process.env['CA_AMQP_PREFIX'])
	amqp_prefix = process.env['CA_AMQP_PREFIX'] + '.';

/*
 * Components on the AMQP network (config service, aggregators, and
 * instrumenters) each create their own key which encodes their type and a
 * unique identifier (usually hostname).
 */
exports.ca_amqp_key_base_aggregator	= amqp_prefix + 'ca.aggregator.';
exports.ca_amqp_key_base_config		= amqp_prefix + 'ca.config.';
exports.ca_amqp_key_base_instrumenter	= amqp_prefix + 'ca.instrumenter.';
exports.ca_amqp_key_base_tool		= amqp_prefix + 'ca.tool.';

/*
 * Each instrumentation gets its own key, which exactly one aggregator
 * subscribes to.  This facilitates distribution of instrumentation data
 * processing across multiple aggregators.
 */
var ca_amqp_key_base_instrumentation = amqp_prefix + 'ca.instrumentation.';

function caRouteKeyForInst(id)
{
	return (ca_amqp_key_base_instrumentation + id);
}

exports.caRouteKeyForInst = caRouteKeyForInst;

/*
 * To facilitate autoconfiguration, each component only needs to know about this
 * global config key.  Upon startup, a component sends a message to this key.
 * The configuration service receives these messages and responds with any
 * additional configuration data needed for this component.
 */
exports.ca_amqp_key_config 		= amqp_prefix + 'ca.config';

/*
 * On startup, the configuration service broadcasts to everyone to let them know
 * that it has (re)started.
 */
exports.ca_amqp_key_all			= amqp_prefix + 'ca.broadcast';

/*
 * Default HTTP ports, shared by the services themselves and the tests.
 */
exports.ca_http_port_config		= 23181;
exports.ca_http_port_agg_base		= 23184;

/*
 * CA Field Types
 */
exports.ca_type_ipaddr			= 'ip_address';
exports.ca_type_string			= 'string';
exports.ca_type_latency			= 'latency';
exports.ca_type_number			= 'number';

/*
 * CA Instrumentation Arities
 */
exports.ca_arity_scalar			= 'scalar';
exports.ca_arity_discrete		= 'discrete-decomposition';
exports.ca_arity_numeric		= 'numeric-decomposition';

/*
 * Unlike the constants above, this default broker is specific to the deployment
 * environment.  But it's used in lots of places and this is the best place for
 * it.
 */
function caBroker()
{
	var broker;

	if (!process.env['AMQP_HOST'])
		throw (new Error('AMQP_HOST not specified'));

	broker = {};
	broker.host = process.env['AMQP_HOST'];

	if (process.env['AMQP_LOGIN'])
		broker.login = process.env['AMQP_LOGIN'];
	if (process.env['AMQP_PASSWORD'])
		broker.password = process.env['AMQP_PASSWORD'];
	if (process.env['AMQP_VHOST'])
		broker.vhost = process.env['AMQP_VHOST'];
	if (process.env['AMQP_PORT'])
		broker.port = process.env['AMQP_PORT'];

	return (broker);
}

exports.caBroker = caBroker;

/*
 * Like the AMQP broker, the MAPI service is configured via environment
 * variables.  But we don't supply defaults for these, since they are actually
 * sensitive.
 */
function caMapiConfig()
{
	if (!process.env['MAPI_HOST'] ||
	    !process.env['MAPI_PORT'] ||
	    !process.env['MAPI_USER'] ||
	    !process.env['MAPI_PASSWORD'])
		return (undefined);

	return ({
		host: process.env['MAPI_HOST'],
		port: process.env['MAPI_PORT'],
		user: process.env['MAPI_USER'],
		password: process.env['MAPI_PASSWORD']
	});
}

exports.caMapiConfig = caMapiConfig;

/*
 * The Cloud Analytics API is versioned with a major and minor number.  Software
 * components should ignore messages received with a newer major version number.
 */
exports.ca_amqp_vers_major		= 1;
exports.ca_amqp_vers_minor		= 1;

function caIncompatible(msg)
{
	return (msg.ca_major !== exports.ca_amqp_vers_major);
}

exports.caIncompatible = caIncompatible;

/*
 * Retry timeout and count: these parameters determine how hard we try to
 * recover when the AMQP broker disappears.
 */
exports.ca_amqp_retry_count		= 3;
exports.ca_amqp_retry_interval		= 5 * 1000; /* 5ms */

function caSysinfo(agentname, agentversion)
{
	var uname = mod_uname.uname();
	var hostname;

	if ('HOST' in process.env && process.env['HOST'].length > 0)
		hostname = process.env['HOST'];
	else
		hostname = uname['nodename'];

	return ({
	    ca_agent_name: agentname,
	    ca_agent_version: agentversion,
	    ca_os_name: uname['sysname'],
	    ca_os_release: uname['release'],
	    ca_os_revision: uname['version'],
	    ca_hostname: hostname,
	    ca_major: exports.ca_amqp_vers_major,
	    ca_minor: exports.ca_amqp_vers_minor
	});
}

exports.caSysinfo = caSysinfo;

/*
 * Deep copy an acyclic *basic* Javascript object.  This only handles basic
 * scalars (strings, numbers, booleans) and arbitrarily deep arrays and objects
 * containing these.  This does *not* handle instances of other classes.
 */
function caDeepCopy(obj)
{
	var ret, key;
	var marker = '__caDeepCopy';

	if (obj && obj[marker])
		throw (new Error('attempted deep copy of cyclic object'));

	if (obj && obj.constructor == Object) {
		ret = {};
		obj[marker] = true;

		for (key in obj) {
			if (key == marker)
				continue;

			ret[key] = exports.caDeepCopy(obj[key]);
		}

		delete (obj[marker]);
		return (ret);
	}

	if (obj && obj.constructor == Array) {
		ret = [];
		obj[marker] = true;

		for (key = 0; key < obj.length; key++)
			ret.push(exports.caDeepCopy(obj[key]));

		delete (obj[marker]);
		return (ret);
	}

	/*
	 * It must be a primitive type -- just return it.
	 */
	return (obj);
}

exports.caDeepCopy = caDeepCopy;
global.caDeepCopy = caDeepCopy;

/*
 * Deep copies each of the keys of 'source' into 'obj'.
 */
function caDeepCopyInto(obj, source)
{
	var key;

	for (key in source)
		obj[key] = exports.caDeepCopy(source[key]);
}

exports.caDeepCopyInto = caDeepCopyInto;

/*
 * Throws an Error with a reasonable message if the specified key does not exist
 * in the object.  If 'prototype' is specified, throws an Error if the type of
 * obj[key] doesn't match the TYPE of 'prototype'.  Returns obj[key].
 */
function caFieldExists(obj, key, prototype)
{
	if (!(key in obj))
		throw (new Error('missing required field: ' + key));

	if (arguments.length > 2 &&
	    typeof (obj[key]) != typeof (prototype))
		throw (new Error('field has wrong type: ' + key));

	return (obj[key]);
}

exports.caFieldExists = caFieldExists;

/*
 * Returns true iff the given Object is empty.
 */
function caIsEmpty(obj)
{
	var key;

	for (key in obj)
		return (false);
	return (true);
}

exports.caIsEmpty = caIsEmpty;
global.caIsEmpty = caIsEmpty;

/*
 * Stripped down version of s[n]printf(3c).  We make a best effort to throw an
 * exception when given a format string we don't understand, rather than
 * ignoring it, so that we won't break existing programs if/when we go implement
 * the rest of this.
 *
 * This implementation currently supports specifying
 *	- field alignment ('-' flag),
 * 	- zero-pad ('0' flag)
 *	- always show numeric sign ('+' flag),
 *	- field width
 *	- conversions for strings, decimal integers, and floats (numbers).
 *	- argument size specifiers.  These are all accepted but ignored, since
 *	  Javascript has no notion of the physical size of an argument.
 *
 * Everything else is currently unsupported, most notably precision, unsigned
 * numbers, non-decimal numbers, and characters.
 */
function caSprintf(fmt)
{
	var regex = [
	    '([^%]*)',				/* non-special */
	    '%',				/* start of format */
	    '([\'\\-+ #0]*?)',			/* flags (optional) */
	    '([1-9]\\d*)?',			/* width (optional) */
	    '(\\.([1-9]\\d*))?',		/* precision (optional) */
	    '[lhjztL]*?',			/* length mods (ignored) */
	    '([diouxXfFeEgGaAcCsSp%jr])'	/* conversion */
	].join('');

	var re = new RegExp(regex);
	var args = Array.prototype.slice.call(arguments, 1);
	var flags, width, precision, conversion;
	var left, pad, sign, arg, match;
	var ret = '';

	ASSERT.equal('string', typeof (fmt));

	while ((match = re.exec(fmt)) !== null) {
		ret += match[1];
		fmt = fmt.substring(match[0].length);

		flags = match[2] || '';
		width = match[3] || 0;
		precision = match[4] || '';
		conversion = match[6];
		left = false;
		sign = false;
		pad = ' ';

		if (conversion == '%') {
			ret += '%';
			continue;
		}

		if (args.length === 0)
			throw (new Error('too few args to sprintf'));

		arg = args.shift();

		if (flags.match(/[\' #]/))
			throw (new Error(
			    'unsupported flags: ' + flags));

		if (precision.length > 0)
			throw (new Error(
			    'non-zero precision not supported'));

		if (flags.match(/-/))
			left = true;

		if (flags.match(/0/))
			pad = '0';

		if (flags.match(/\+/))
			sign = true;

		switch (conversion) {
		case 's':
			ret += doPad(pad, width, left, arg);
			break;

		case 'd':
			arg = Math.floor(arg);
			/*jsl:fallthru*/
		case 'f':
			sign = sign && arg > 0 ? '+' : '';
			ret += sign + doPad(pad, width, left,
			    arg.toString());
			break;

		case 'j': /* non-standard */
			if (width === 0)
				width = 10;
			ret += mod_sys.inspect(arg, false, width);
			break;

		case 'r': /* non-standard */
			ret += dumpException(arg);
			break;

		default:
			throw (new Error('unsupported conversion: ' +
			    conversion));
		}
	}

	ret += fmt;
	return (ret);
}

exports.caSprintf = caSprintf;
global.caSprintf = caSprintf;

function doPad(chr, width, left, str)
{
	var ret = str;

	while (ret.length < width) {
		if (left)
			ret += chr;
		else
			ret = chr + ret;
	}

	return (ret);
}

function dumpException(ex)
{
	var ret;

	ret = 'EXCEPTION: ' + ex.constructor.name + ': ' + ex;
	if (ex.stack)
		ret += '\n' + ex.stack;

	if (!ex.cause)
		return (ret);

	for (ex = ex.cause(); ex; ex = ex.cause())
		ret += '\nCaused by: ' + dumpException(ex);

	return (ret);
}

/*
 * Formats a date using a reasonable format string.
 */
function caFormatDate(now)
{
	return (exports.caSprintf('%4d-%02d-%02d %02d:%02d:%02d.%03d UTC',
	    now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(),
	    now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(),
	    now.getUTCMilliseconds()));
}

exports.caFormatDate = caFormatDate;
global.caFormatDate = caFormatDate;

function caNoop() {}
exports.caNoop = caNoop;
global.caNoop = caNoop;

/*
 * Given a customer identifier and per-customer instrumentation identifier,
 * return the fully qualified instrumentation id.  If custid is undefined, it is
 * assumed that instid refers to the global scope.  For details, see the block
 * comment at the top of this file on cfg_insts.
 */
function caQualifiedId(custid, instid)
{
	if (custid === undefined)
		return ('global;' + instid);

	return ('cust:' + custid + ';' + instid);
}

exports.caQualifiedId = caQualifiedId;

/*
 * A simple function to walk an array and see if it contains a given field.
 */
function caArrayContains(arr, field)
{
	var ii;

	for (ii = 0; ii < arr.length; ii++) {
		if (arr[ii] == field)
			return (true);
	}

	return (false);
}

exports.caArrayContains = caArrayContains;
global.caArrayContains = caArrayContains;

/*
 * Look for the given 'key' in params and validate it.  'formals' is an object
 * whose keys represent valid parameters and whose values are objects describing
 * legal and default values for each parameter.  Parameters must have the
 * following field:
 *
 *	type		'number' | 'boolean' | 'array' | 'enum'
 *			All actual parameters come in as strings.  Array values
 *			are automatically split on commas.
 *
 * and may have the following additional fields:
 *
 *	choices 	array of legal string-valued choices
 *			('enum'	params only)
 *
 *	default		default value if this parameter is not specified
 *
 *	max		maximum value ('number' params only)
 *
 *	min		minimum value ('number' params only)
 *
 *	required	parameter value must be specified
 *
 * If one of the above optional fields isn't specified, that constraint is not
 * validated.  For example, if no maximum is specified, then a number has no
 * maximum constraint.
 *
 * If the parameter cannot be validated, a caValidationError is thrown.
 */
function caHttpParam(formals, actuals, param)
{
	var decl, rawval, value, error;

	ASSERT.ok(param in formals);
	decl = formals[param];

	if (!(param in actuals)) {
		if (decl.required)
			throw (new caValidationError(exports.caSprintf(
			    'param "%s" must be specified', param)));

		return (decl.default);
	}

	error = function (reason) {
		throw (new caValidationError(exports.caSprintf(
		    'value "%s" for param "%s" not valid: %s',
		    rawval, param, reason)));
	};

	rawval = actuals[param];

	switch (decl.type) {
	case 'number':
		value = parseInt(rawval, 10);

		if (isNaN(value))
			error('not a number');

		if ('min' in decl && value < decl.min)
			error('value too small (min: ' + decl.min + ')');

		if ('max' in decl && value > decl.max)
			error('value too large (max: ' + decl.max + ')');

		break;

	case 'boolean':
		switch (rawval) {
		case 'true':
			value = true;
			break;

		case 'false':
			value = false;
			break;

		default:
			error('not a boolean');
			break;
		}

		break;

	case 'array':
		if (typeof (rawval) == 'string') {
			value = rawval.split(',');
		} else {
			ASSERT.ok(rawval.constructor == Array);
			value = rawval;
		}

		break;

	case 'enum':
		if (!(rawval in decl.choices))
			error('unsupported value');

		value = rawval;

		break;

	default:
		throw (new Error('invalid param type: ' + decl.type));
	}

	return (value);
}

exports.caHttpParam = caHttpParam;
global.caHttpParam = caHttpParam;

/*
 * caRunStages is given an array "stages" of functions, an initial argument
 * "arg", and a callback "callback".  Each stage represents some task,
 * asynchronous or not, which should be completed before the next stage is
 * started.  Each stage is invoked with the result of the previous stage and can
 * abort this process if it encounters an error.  When all stages have
 * completed, "callback" is invoked with the error and results of the last stage
 * that was run.
 *
 * More precisely: the first function of "stages" may be invoked during
 * caRunStages or immediately after (asynchronously).  Each stage is invoked as
 * stage(arg, callback), where "arg" is the result of the previous stage (or
 * the "arg" specified to caRunStages, for the first stage) and "callback"
 * should be invoked when the stage is complete.  "callback" should be invoked
 * as callback(err, result), where "err" is a non-null instance of Error iff an
 * error was encountered and null otherwise, and "result" is an arbitrary object
 * to be passed to the next stage.  The "callback" given to caRunStages is
 * invoked after the last stage has been run with the arguments given to that
 * stage's completion callback.
 */
function caRunStages(stages, arg, callback)
{
	var stage, next;

	next = function (err, result) {
		var nextfunc;

		if (err)
			return (callback(err, result));

		nextfunc = stages[stage++];
		if (!nextfunc)
			return (callback(null, result));

		return (nextfunc(result, next));
	};

	stage = 0;
	next(null, arg);
}

exports.caRunStages = caRunStages;
global.caRunStages = caRunStages;

/*
 * Given an object and one of its methods, return a function that invokes the
 * method in the context of the specified object.
 */
function caWrapMethod(obj, method)
{
	/* JSSTYLED */
	return (function () { return (method.apply(obj, arguments)); });
}

exports.caWrapMethod = caWrapMethod;
global.caWrapMethod = caWrapMethod;

/*
 * caTimeKeeper is a simple facility for recording millisecond timestamps for
 * identifying expensive operations.
 */
function caTimeKeeper(name)
{
	this.ctk_name = name || 'operation';
	this.ctk_steps = [];
	this.step('start');
}

caTimeKeeper.prototype.step = function (name)
{
	this.ctk_steps.push({ name: name, time: new Date().getTime() });
};

caTimeKeeper.prototype.toString = function ()
{
	var ret = '';
	var total, ii, step, delta;

	ret = this.ctk_name + ':\n';

	total = this.ctk_steps[this.ctk_steps.length - 1]['time'] -
	    this.ctk_steps[0]['time'];

	for (ii = 1; ii < this.ctk_steps.length; ii++) {
		step = this.ctk_steps[ii];
		delta = step['time'] - this.ctk_steps[ii - 1]['time'];
		ret += caSprintf('%s: %dms (%5f%%)\n', step['name'],
		    delta, delta / total * 100);
	}

	ret += caSprintf('Total: %dms\n', total);
	return (ret);
};

exports.caTimeKeeper = caTimeKeeper;

/*
 * Runs a series of functions that complete asynchronously. The functions should
 * take a callback which is a function that has the form (err, result).  We will
 * run each function in 'functions' to completion and assemble an array of
 * results to look at. Invokes 'callback' an object with the following fields:
 *
 *	results		An array of objects. Each object contains one field.
 *			That field will either be 'result' or 'error'. When the
 *			field is 'error' the object it points to will be an
 *			error that the function passed to the callback. If the
 *			function completed successfully the 'result' field will
 *			contain the results passed to the callback.
 *
 *	nerrors		A number that mentions how many errors were found
 *
 *	errlocs		An array of numbers where each entry has an index into
 *			results that says which entries have errors
 */
function caRunParallel(functions, callback)
{
	var ii, nfuncs, res, mkcb, errs;

	ASSERT.ok(functions !== undefined, 'missing functions argument');

	ASSERT.ok(functions instanceof Array, 'functions should be an array');

	ASSERT.ok(functions.length > 0, 'functions array should be non-zero');

	for (ii = 0; ii < functions.length; ii++)
		ASSERT.ok(typeof (functions[ii]) == 'function', 'functions ' +
		    'should be an array of functions');

	ASSERT.ok(callback !== undefined, 'missing callback');

	nfuncs = functions.length;
	errs = [];
	res = new Array(nfuncs);

	mkcb = function (jj) {
		return (function (err, result) {
			if (err) {
				errs.push(jj);
				res[jj] = { error: err };
			} else {
				res[jj] = { result: result };
			}

			if (--nfuncs === 0) {
				callback({
					results: res,
					nerrors: errs.length,
					errlocs: errs
				});
			}
		});
	};

	for (ii = 0; ii < functions.length; ii++) {
		functions[ii](mkcb(ii));
	}
}

exports.caRunParallel = caRunParallel;
global.caRunParallel = caRunParallel;

/*
 * This is a kludge.  ca-error invokes caSprintf indirectly from the top level,
 * so it can't be loaded before caSprintf is defined above.  However, we use
 * caValidationError, which is defined in ca-error.  At least we don't use it
 * from the top-level, which allows us to cheat by doing the require here.
 */
require('./ca-error');
