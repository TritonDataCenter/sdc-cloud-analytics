/*
 * ca-error.js: common error handling functions and classes
 */

var mod_sys = require('sys');
var ASSERT = require('assert');

var mod_ca = require('./ca-common');

/*
 * Available error codes and their default messages.  These codes are available
 * as variables in the global context.
 */
var caErrorMessages = {
    'ECA_EXISTS':	'object already exists',
    'ECA_INVAL':	'invalid argument',
    'ECA_IO':		'i/o error',
    'ECA_NOENT':	'no such object',
    'ECA_NORESOURCE':	'insufficient resources',
    'ECA_REMOTE':	'remote service failure',
    'ECA_TIMEDOUT':	'timed out',
    'ECA_UNKNOWN':	'unknown error'
};

var errcode;
for (errcode in caErrorMessages)
	global[errcode] = errcode;

/*
 * Generic error class.  The constructor is invoked as (code, wrapped, ...)
 * where:
 *
 *	code	is one of the defined codes above
 *
 *	wrapped	(optional) wrapped exception, usually representing the cause
 *
 *	... 	(optional) processed by caSprintf() and used as the exception's
 *		message.
 */
function caError(code, wrapped)
{
	var args, msg, longmsg;

	ASSERT.ok(code);
	ASSERT.ok(code in caErrorMessages);

	args = Array.prototype.slice.call(arguments, 2);
	if (args.length > 0)
		msg = caSprintf.apply(null, args);
	else
		msg = caErrorMessages[code];

	if (wrapped) {
		ASSERT.ok(wrapped instanceof Error);
		longmsg = msg + ': ' + wrapped.message;
	} else {
		longmsg = msg;
	}

	this.e_code = code;
	this.e_message = this.message = msg;
	this.e_wrapped = wrapped;
	this.e_summary = longmsg;
	Error.apply(this, [ msg ]);

	if (Error.captureStackTrace)
		Error.captureStackTrace(this);
}

caError.prototype = new Error();
caError.prototype.constructor = caError;
caError.prototype.name = 'caError';

exports.caError = caError;
global.caError = caError;

caError.prototype.toString = function ()
{
	return (this.e_summary);
};

caError.prototype.code = function ()
{
	return (this.e_code);
};

caError.prototype.cause = function ()
{
	return (this.e_wrapped);
};

caError.prototype.stacktrace = function ()
{
	return (this.stack);
};

/*
 * caValidationErrors represent user input errors.
 *
 * caInvalidFieldError should be preferred to caValidationError because it
 * provides uniformity in both human-readable error messages and programmatic
 * access to data like the field that was invalid and why it was invalid.
 */
function caValidationError(msg)
{
	caError.apply(this, [ ECA_INVAL, null, msg ]);
}

mod_sys.inherits(caValidationError, caError);
caValidationError.prototype = new caError(ECA_INVAL);
caValidationError.prototype.constructor = caValidationError;
caValidationError.prototype.name = 'caValidationError';

exports.caValidationError = caValidationError;
global.caValidationError = caValidationError;


/*
 * Represents a validation error where a particular field has a missing or
 * illegal value.  Constructed as caInvalidFieldError(field, value, ...), where
 * the remaining arguments are processed by caSprintf to form the reason why the
 * value is invalid.  If no reason is specified, a default is provided.
 */
function caInvalidFieldError(field, value)
{
	var args;

	this.civ_field = field;
	this.civ_value = value;

	if (value === undefined) {
		this.civ_reason = 'missing';
		caValidationError.apply(this, [ caSprintf(
		    'missing value for required field: "%s"', field) ]);
		return;
	}

	args = Array.prototype.slice.call(arguments, 2);
	if (args.length > 0)
		this.civ_reason = caSprintf.apply(null, args);
	else
		this.civ_reason = 'illegal value';

	caValidationError.apply(this, [ caSprintf(
	    'value %s for field "%s" is invalid: %s', JSON.stringify(value),
	    field, this.civ_reason) ]);
}

mod_sys.inherits(caInvalidFieldError, caValidationError);
caInvalidFieldError.prototype = new caValidationError(ECA_INVAL);
caInvalidFieldError.prototype.constructor = caInvalidFieldError;
caInvalidFieldError.prototype.name = 'caInvalidFieldError';

exports.caInvalidFieldError = caInvalidFieldError;
global.caInvalidFieldError = caInvalidFieldError;

caInvalidFieldError.prototype.field = function ()
{
	return (this.civ_field);
};

caInvalidFieldError.prototype.value = function ()
{
	return (this.civ_value);
};

caInvalidFieldError.prototype.reason = function ()
{
	return (this.civ_reason);
};

/*
 * Represents an error object for system errors.
 */
function caSystemError(cause)
{
	var args, code;

	ASSERT(cause);
	ASSERT(cause instanceof Error);
	ASSERT('code' in cause);
	ASSERT('errno' in cause);

	this.cse_syscode = cause['code'];

	switch (this.cse_syscode) {
	case 'EEXIST':	code = ECA_EXISTS;	break;
	case 'ENOENT':	code = ECA_NOENT;	break;
	case 'EIO':	code = ECA_IO;		break;
	case 'EAGAIN':
	case 'ENOMEM':
			code = ECA_NORESOURCE;	break;
	default:	code = ECA_INVAL;	break;
	}

	args = Array.prototype.slice(arguments);
	args.unshift(code);
	caError.apply(this, args);
}

exports.caSystemError = caSystemError;
global.caSystemError = caSystemError;

mod_sys.inherits(caSystemError, caError);
caSystemError.prototype = new caError(ECA_IO);

caSystemError.prototype.syscode = function ()
{
	return (this.cse_syscode);
};
