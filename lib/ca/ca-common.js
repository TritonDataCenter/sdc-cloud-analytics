/*
 * ca.js: Cloud Analytics system constants and common routines.
 */

var ASSERT = require('assert');
var mod_fs = require('fs');
var mod_path = require('path');
var mod_sys = require('sys');
var mod_uname = require('uname');

/*
 * Default HTTP ports, shared by the services themselves and the tests.
 */
exports.ca_http_port_config		= 23181;
exports.ca_http_port_agg_base		= 23184;

/*
 * CA Field Arities
 */
exports.ca_field_arity_discrete		= 'discrete';
exports.ca_field_arity_numeric		= 'numeric';

/*
 * CA Instrumentation Arities
 */
exports.ca_arity_scalar			= 'scalar';
exports.ca_arity_discrete		= 'discrete-decomposition';
exports.ca_arity_numeric		= 'numeric-decomposition';

/*
 * Minimum value for "granularity" > 1.  Instrumenters report data at least this
 * frequently, and all values for "granularity" must be a multiple of this.
 */
exports.ca_granularity_min = 5;

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
	    ca_major: mod_cap.ca_amqp_vers_major,
	    ca_minor: mod_cap.ca_amqp_vers_minor
	});
}

exports.caSysinfo = caSysinfo;

/*
 * Return true iff the specified objects are deeply equal.
 */
function caDeepEqual(lhs, rhs)
{
	var key;

	if (typeof (lhs) !== 'object')
		return (lhs === rhs);

	for (key in lhs) {
		if (!(key in rhs))
			return (false);
	}

	for (key in rhs) {
		if (!(key in lhs))
			return (false);

		if (!caDeepEqual(lhs[key], rhs[key]))
			return (false);
	}

	return (true);
}

exports.caDeepEqual = caDeepEqual;
global.caDeepEqual = caDeepEqual;

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
 * Returns the number of properties of the given object.
 */
function caNumProps(obj)
{
	var key, rv;

	rv = 0;
	for (key in obj)
		rv++;

	return (rv);
}

exports.caNumProps = caNumProps;
global.caNumProps = caNumProps;

/*
 * Removes circular references from "obj".  This changes the original object.
 */
function caRemoveCircularRefs(obj)
{
	var key, marker, circular;

	marker = 'caRemoveCircular';
	circular = '<circular>';

	if (typeof (obj) != typeof ({}))
		return;

	if (obj === null)
		return;

	ASSERT.ok(!(marker in obj));
	obj[marker] = true;

	/*
	 * The following works for both arrays and general objects.
	 */
	for (key in obj) {
		if (typeof (obj[key]) == typeof ({}) &&
		    obj[key] !== null && obj[key][marker]) {
			obj[key] = circular;
			continue;
		}

		caRemoveCircularRefs(obj[key]);
	}

	delete (obj[marker]);
}

exports.caRemoveCircularRefs = caRemoveCircularRefs;
global.caRemoveCircularRefs = caRemoveCircularRefs;

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

	if (!(ex instanceof Error))
		throw (new Error(caSprintf('invalid type for %%r: %j', ex)));

	/*
	 * Note that V8 prepends "ex.stack" with ex.toString().
	 */
	ret = 'EXCEPTION: ' + ex.constructor.name + ': ' + ex.stack;

	if (!ex.cause)
		return (ret);

	for (ex = ex.cause(); ex; ex = ex.cause ? ex.cause() : null)
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

/*
 * Return true if the input string starts with the specified prefix.
 */
function caStartsWith(str, prefix)
{
	var ii;

	if (prefix.length > str.length)
		return (false);

	for (ii = 0; ii < prefix.length; ii++) {
		if (str[ii] != prefix[ii])
			return (false);
	}

	return (true);
}

exports.caStartsWith = caStartsWith;
global.caStartsWith = caStartsWith;

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
 * Given two arrays of strings, return a new array resulting from including all
 * values from both arrays.  Duplicates will be removed, and the order of
 * entries in both arrays is preserved, prefering the order in the first array.
 */
function caArrayMerge(orig, addl)
{
	var seen, ii, ret;

	seen = {};

	for (ii = 0; ii < orig.length; ii++)
		seen[orig[ii]] = true;

	for (ii = 0; ii < addl.length; ii++)
		seen[addl[ii]] = true;

	ret = [];
	for (ii = 0; ii < orig.length; ii++) {
		if (!(orig[ii] in seen))
			continue;

		ret.push(orig[ii]);
		delete (seen[orig[ii]]);
	}

	for (ii = 0; ii < addl.length; ii++) {
		if (!(addl[ii] in seen))
			continue;

		ret.push(addl[ii]);
		delete (seen[addl[ii]]);
	}

	ASSERT.ok(caIsEmpty(seen));
	return (ret);
}

exports.caArrayMerge = caArrayMerge;
global.caArrayMerge = caArrayMerge;


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
 *	results		An array of objects describing the results of each
 *			callback function. The order of these results matches
 *			the order of the functions themselves. Each entry
 *			contains one field.  That field will either be 'result'
 *			or 'error'. When the field is 'error' the object it
 *			points to will be an error that the function passed to
 *			the callback. If the function completed successfully the
 *			'result' field will contain the results passed to the
 *			callback.
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

	if (functions.length === 0) {
		setTimeout(function () {
			callback({ results: [], nerrors: 0, errlocs: [] });
		}, 0);
		return;
	}

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
 * Returns true iff the given string ends with the given suffix.
 */
function caEndsWith(str, suffix)
{
	var ii;

	if (str.length < suffix.length)
		return (false);

	for (ii = 0; ii < suffix.length; ii++) {
		if (str[str.length - suffix.length + ii] != suffix[ii])
			return (false);
	}

	return (true);
}

exports.caEndsWith = caEndsWith;
global.caEndsWith = caEndsWith;

/*
 * Substitutes occurences of $var inside 'str' with the result of invoking
 * substitution('var').
 */
function caSubstitute(str, substitution)
{
	var re, matches;

	re = /\$[a-zA-Z0-9]+/;
	while ((matches = re.exec(str)) != null) {
		str = str.replace(matches[0],
		    substitution(matches[0].substring(1)));
		re.lastIndex = 0;
	}

	return (str);
}

exports.caSubstitute = caSubstitute;
global.caSubstitute = caSubstitute;

function caSubObject(obj)
{
	/* JSSTYLED */
	return (function (key) { return (obj[key]); });
}

exports.caSubObject = caSubObject;
global.caSubObject = caSubObject;

/*
 * Reads the named file and parses it as JSON.
 */
function caReadFileJson(filename, callback)
{
	mod_fs.readFile(filename, 'utf-8', function (err, contents) {
		var json;

		if (err)
			return (callback(new caSystemError(err,
			    'failed to read file "%s"', filename)));

		try {
			json = JSON.parse(contents);
		} catch (ex) {
			return (callback(new caError(ECA_INVAL, ex,
			    'failed to JSON file "%s"', filename)));
		}

		return (callback(null, json));
	});
}

exports.caReadFileJson = caReadFileJson;
global.caReadFileJson = caReadFileJson;

/*
 * Writes the specified data to the named file.  The callback will be invoked
 * only after the data has been syncked to disk.
 */
function caSaveFile(filename, data, callback)
{
	var open, write, sync;
	var fd, nwritten;

	open = function (unused, subcallback) {
		mod_fs.open(filename, 'w', 0666, subcallback);
	};

	write = function (ofd, subcallback) {
		fd = ofd;
		mod_fs.write(fd, data, nwritten, data.length - nwritten, null,
		    function (err, nbytes) {
			if (err)
				return (subcallback(err));

			nwritten += nbytes;
			if (nwritten < data.length)
				return (write(fd, subcallback));

			return (subcallback(null, fd));
		    });
	};

	sync = mod_fs.fsync;

	nwritten = 0;
	caRunStages([ open, write, sync ], null, function (err, result) {
		if (fd === undefined)
			return (callback(new caSystemError(err,
			    'failed to open file "%s"', filename)));

		return (mod_fs.close(fd, function () {
			/* We ignore any error from close. */
			if (err)
				err = new caSystemError(err,
				    'failed to write or sync file "%s"',
				    filename);
			return (callback(err));
		}));
	});
}

exports.caSaveFile = caSaveFile;
global.caSaveFile = caSaveFile;

/*
 * Like POSIX rename() (or mod_fs.rename()), but waits until the changes are
 * flushed to stable storage.
 */
function caRename(src, dst, callback)
{
	var dstdir, stages, rfd, renamed;

	/*
	 * We use mod_fs.rename() and then fsync() to flush the outstanding
	 * changes to stable storage.  fsyncking either the source or
	 * destination directory should be sufficient since the rename() itself
	 * is guaranteed to be atomic.  We choose the destination.  We normalize
	 * "dst" before computing dirname because mod_path.dirname() doesn't
	 * properly deal with multiple trailing slashes.
	 */
	dstdir = mod_path.dirname(mod_path.normalize(dst));
	stages = [];

	stages.push(function (unused, subcallback) {
		mod_fs.rename(src, dst, subcallback);
	});

	stages.push(function (unused, subcallback) {
		renamed = true;
		mod_fs.open(dstdir, 'r', 0777, subcallback);
	});

	stages.push(function (fd, subcallback) {
		rfd = fd;
		mod_fs.fsync(fd, subcallback);
	});

	caRunStages(stages, null, function (err, result) {
		if (!renamed)
			return (callback(new caSystemError(err,
			    'failed to rename "%s" to "%s"', src, dst)));

		if (rfd === undefined)
			return (callback(new caSystemError(err,
			    'failed to open directory "%s" for sync', dstdir)));

		if (err)
			err = new caSystemError(err,
			    'failed to sync directory "%s"', dstdir);

		/* We ignore any error from close. */
		return (mod_fs.close(rfd,
		    function () { return (callback(err)); }));
	});
}

exports.caRename = caRename;
global.caRename = caRename;

/*
 * This is a kludge.  ca-error invokes caSprintf indirectly from the top level,
 * so it can't be loaded before caSprintf is defined above.  However, we use
 * caValidationError, which is defined in ca-error.  At least we don't use it
 * from the top-level, which allows us to cheat by doing the require here.
 * Ditto ca-amqp-cap.
 */
require('./ca-error');
var mod_cap = require('./ca-amqp-cap');
