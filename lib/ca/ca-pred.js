/*
 * ca-pred.js: Provide utilities related to handling and processing predicates.
 *
 * We export several functions:
 *  - caPredValidate: Validates a given predicate or throws an error if it
 *  fails.
 *  - caPredPrint: Returns a valid D expression for the predicate
 *  - caPredWalk: Walks a predicate applying a function at every leaf
 *  - caPredContainsField: Returns true if a predicate contains a given field
 *  - caPredReplaceFields: Replaces each fieldname with a new value
 */
var mod_ca = require('./ca-common');
var mod_caerr = require('./ca-error');

var ValidationError = caValidationError;
exports.caPredValidationError = ValidationError;

/*
 * A mapping from a predicate key to the type specific parsing routine.
 */
var parseFuncs = {
    lt: caPredValidateRel,
    le: caPredValidateRel,
    gt: caPredValidateRel,
    ge: caPredValidateRel,
    eq: caPredValidateRel,
    ne: caPredValidateRel,
    and: caPredValidateLog,
    or: caPredValidateLog
};

/*
 * A mapping that determines which specific instrumentation fields are supported
 * by which predicate relational and logical operators.
 */
var keyFields = {
    lt: {},
    le: {},
    gt: {},
    ge: {},
    eq: {},
    ne: {}
};

keyFields['lt'][mod_ca.ca_type_latency] = true;
keyFields['lt'][mod_ca.ca_type_string] = false;
keyFields['le'][mod_ca.ca_type_latency] = true;
keyFields['le'][mod_ca.ca_type_string] = false;
keyFields['gt'][mod_ca.ca_type_latency] = true;
keyFields['gt'][mod_ca.ca_type_string] = false;
keyFields['ge'][mod_ca.ca_type_latency] = true;
keyFields['ge'][mod_ca.ca_type_string] = false;
keyFields['eq'][mod_ca.ca_type_latency] = true;
keyFields['eq'][mod_ca.ca_type_string] = true;
keyFields['ne'][mod_ca.ca_type_latency] = true;
keyFields['ne'][mod_ca.ca_type_string] = true;

/*
 * A mapping to the operator specific printing routine.
 */
var printFuncs = {
    lt: caPredPrintRel,
    le: caPredPrintRel,
    gt: caPredPrintRel,
    ge: caPredPrintRel,
    eq: caPredPrintRel,
    ne: caPredPrintRel,
    and: caPredPrintLog,
    or: caPredPrintLog
};

/*
 * The operator specific string to use while printing
 */
var printStrings = {
    lt: '<',
    le: '<=',
    gt: '>',
    ge: '>=',
    eq: '==',
    ne: '!=',
    and: '&&',
    or: '||'
};

/*
 * Gets the key for the given predicate
 *
 * Input:
 *  - pred: The predicate to get the key for
 * Output:
 *  - returns the key for the specified predicate object
 */
function caPredGetKey(pred)
{
	var key, keysFound = 0;

	for (var val in pred) {
		keysFound++;
		key = val;
	}

	if (keysFound > 1)
		throw (new ValidationError(mod_ca.caSprintf('Found too many ' +
		    'keys: %d. Expected one. Current predicate: %j.',
		     keysFound, pred)));

	if (keysFound < 1)
		throw (new ValidationError(mod_ca.caSprintf('Predicate is ' +
		    'missing a key. Current predicate: %j', pred)));

	return (key);
}

/*
 * Validates if a given field is valid for the instrumentation in question and
 * returns the specific type of the field.
 *
 * Input:
 *  - inst: The instrumenter for this predicate
 *  - field: The string name of the field that we want to use
 * Output:
 *  - Returns a string that dictates the type of the field. Currently supported:
 *   -- Numeric (an integer based value)
 *   -- Discrete (a string based value)
 */
function caPredValidateInstField(inst, field)
{
	if (!(field in inst))
		throw (new ValidationError(mod_ca.caSprintf('Instrumenter ' +
		    'does not have field %s. Instrumenter fields: %j',
		    field, inst)));

	/* XXX This needs to be reworked for additional types */
	if (inst[field].type == mod_ca.ca_type_latency)
		return (mod_ca.ca_type_latency);

	return (mod_ca.ca_type_string);
}

/*
 * Validates that the predicate has a valid format for relational predicates.
 * That means that it fits the format:
 * { key: [ field, constant ] }
 *
 * Input:
 *  - inst: The instrumentation
 *  - pred: The predicate
 *  - key: The key that we're interested in
 *
 * On return the following points have been validated:
 *  - That the key points to a two element array
 *  - That the first field is a valid type
 *  - That the constant is a valid type for the field
 *  - That the relation is a valid type for the field
 */
function caPredValidateRel(inst, pred, key)
{
	var field, constant, type;

	if (!pred[key])
		throw (new ValidationError(mod_ca.caSprintf('Predicate is ' +
		    'missing key %j. Current predicate: %j', key, pred)));

	if (!(pred[key] instanceof Array))
		throw (new ValidationError(mod_ca.caSprintf('Predicate key ' +
		    'does not point to an array. Current predicate: %j',
		    pred)));

	if (pred[key].length != 2)
		throw (new ValidationError(mod_ca.caSprintf('Predicate key ' +
		    'does not point to an array of two elements. Found %d ' +
		    'elements. Current predicate: %j', pred[key].length,
		     pred)));

	field = pred[key][0];
	constant = pred[key][1];

	if (typeof (field) != 'string')
		throw (new ValidationError(mod_ca.caSprintf('Predicate ' +
		    'field is not a string. Got %j. Current predicate: %j',
		    field, pred)));

	if (typeof (constant) != 'number' && typeof (constant) != 'string')
		throw (new ValidationError(mod_ca.caSprintf('Predicate ' +
		    'constant is not a constant. Got %j. Current predicate: %j',
		    constant, pred)));

	type = caPredValidateInstField(inst, field);

	if (!keyFields[key][type])
		throw (new ValidationError(mod_ca.caSprintf('Predicate ' +
		    'field %s is not a valid type (%s) for the specified key ' +
		    '%s. Current predicate: %j', field, type, key, pred)));

	/*
	 * TODO If we add additional numeric types, this will need to be
	 * refactored
	 */
	if (type == mod_ca.ca_type_latency && typeof (constant) != 'number')
		throw (new ValidationError(mod_ca.caSprintf('Predicate field ' +
		    'is of type numeric, but the constant is not a number. ' +
		    'Got type %s. Current predicate: %j', typeof (constant),
		    pred)));

	if (type != mod_ca.ca_type_latency && typeof (constant) != 'string')
		throw (new ValidationError(mod_ca.caSprintf('Predicate field ' +
		    'is of type discrete, but the constant is not a string. ' +
		    'Got type %s. Current predicate: %j', typeof (constant),
		    pred)));
}

/*
 * Validates that the logical expression has a valid format. This means that it
 * is of the format:
 * { key: [ obj, obj,... ] }
 *
 * Input:
 *  - inst: The instrumentation
 *  - pred: The current predicate
 *  - key: The key that we're interested in
 *
 * On Return the following points have been validated:
 *  - The key points to an array of at least length two
 *  - Every object in the array is a valid predicate or logical expression
 */
function caPredValidateLog(inst, pred, key)
{
	var ii;

	if (!pred[key])
		throw (new ValidationError(mod_ca.caSprintf('Logical expr is ' +
		    'missing key %j. Current expression: %j', key, pred)));

	if (!(pred[key] instanceof Array))
		throw (new ValidationError(mod_ca.caSprintf('Logical expr ' +
		    'key does not point to an array. Current expression: %j',
		    pred)));

	if (pred[key].length < 2)
		throw (new ValidationError(mod_ca.caSprintf('Logical expr ' +
		    'key does not contain enough elements. Found %d, ' +
		    'expected at least two. Current expression: %j',
		    pred[key].length, pred)));

	for (ii = 0; ii < pred[key].length; ii++)
		caPredValidate(inst, pred[key][ii]);
}

/*
 * This is the entry point for validating and parsing any given predicate. This
 * will be called when beginning to parse any specific predicate.
 *
 * Input:
 *  - inst: An object where each key is a field of the stat and the value is an
 *    object that has a field called type with the correct type
 *  - pred: The predicate that we want to validate
 * Output: None on success, an exception is thrown on error.
 */
function caPredValidate(inst, pred)
{
	var key;

	if (!caPredNonTrivial(pred))
		return;

	key = caPredGetKey(pred);
	if (!parseFuncs[key])
		throw (new ValidationError(mod_ca.caSprintf('Invalid key: ' +
		    '%s. Current predicate: %j', key, pred)));

	parseFuncs[key](inst, pred, key);
}

exports.caPredValidate = caPredValidate;

/*
 * Prints out the value of a relational predicate.
 * This should print as:
 * <field> <operator> <constant>
 *
 * Input:
 *  - pred: The predicate to print
 *  - key: The key for the predicate
 *
 * Output:
 *  - Returns the string representation of the specified predicate.
 */
function caPredPrintRel(pred, key)
{
	var out = pred[key][0] + ' ';

	out += printStrings[key] + ' ';
	if (typeof (pred[key][1]) == 'string')
		out += '"';
	out += pred[key][1];
	if (typeof (pred[key][1]) == 'string')
		out += '"';

	return (out);
}

/*
 * Prints out the value of a logical expression.
 * This should print as:
 * (<predicate>) <operator> (<predicate>)...
 *
 * The parens may seem unnecessary in most cases, but it is designed to
 * distinguish between nested logical expressions.
 *
 * Inputs:
 *  - pred: The logical expression to print
 *  - key: The key for the object in the logical expression
 *
 * Output:
 *  - Returns the string representation of the specified predicate.
 */
function caPredPrintLog(pred, key)
{
	var elts = pred[key].map(function (x) {
		return ('(' + caPredPrintGen(x) + ')');
	});

	return (elts.join(' ' + printStrings[key] + ' '));
}

/*
 * This is the generic entry point to begin parsing an individual predicate.
 * This is responsible for determining the key and dispatching to the correct
 * function.
 *
 * Inputs:
 *  - pred: The predicate to be printed
 *
 * Output:
 *  - Returns the string representation of the specified predicate.
 */
function caPredPrintGen(pred)
{
	var key;
	var keysFound = 0;

	/* Let's just do a bit of extra sanity checking, can't hurt */
	for (var val in pred) {
		key = val;
		keysFound++;
	}

	if (keysFound != 1)
		throw (new ValidationError(mod_ca.caSprintf('Expected only ' +
		    'one key for the specified predicate. Found %d. Looking ' +
		    'at predicate %j', keysFound, pred)));

	if (!printFuncs[key])
		throw (new ValidationError(mod_ca.caSprintf('Missing print ' +
		    'function for key %s. Looking at predicate %j', key,
		    pred)));

	return (printFuncs[key](pred, key));
}

/*
 * Prints out a human readable form of a predicate. This is the general entry
 * point.
 *
 * Input:
 *  - pred: A predicate that has already been validated by caPredValidate
 *
 * Output:
 *  - Returns the string representation of the specified predicate.
 */
function caPredPrint(pred)
{
	return (caPredPrintGen(pred));
}

exports.caPredPrint = caPredPrint;

/*
 * We want to walk every leaf predicate and apply a function to it
 * Input:
 *  - func: A function of the signature void (*func)(predicate, key)
 *  - pred: A predicate that has previously been validated
 */
function caPredWalk(func, pred)
{
	var key, ii;

	if (!caPredNonTrivial(pred))
		return;

	key = caPredGetKey(pred);

	switch (key) {
	case 'and':
	case 'or':
		for (ii = 0; ii < pred[key].length; ii++)
			caPredWalk(func, pred[key][ii]);

		break;
	default:
		func(pred, key);
		break;
	}

}

exports.caPredWalk = caPredWalk;

/*
 * Walk a predicate and check if any of the leaves are checking a specific
 * field.
 * Input:
 *  - field: The name of the field to search for
 *  - pred: The predicate to search in
 */
function caPredContainsField(field, pred)
{
	var found = false;

	caPredWalk(function (x, key) {
	    if (x[key][0] == field)
		found = true;
	}, pred);

	return (found);
}

exports.caPredContainsField = caPredContainsField;

/*
 * Walks the predicate and replaces all of the field names with appropriate
 * values from the specified object. The object is defined where each possible
 * predicate field is a key in the object and we replace the predicate field
 * with the value from the object. This allows us to replace simple consumer
 * predicate names i.e. latency or optype with the correct D expressions.
 *
 * Input:
 *  - obj: An Object where keys match the fields in the predicate and the values
 *    are what should be substituted in
 *  - pred: The predicate to apply this transformation to
 */
function caPredReplaceFields(obj, pred)
{
	caPredWalk(function (x, key) {
	    var field = x[key][0];
	    if (!(field in obj))
		    throw (new ValidationError(mod_ca.caSprintf('Cannot find ' +
			'replacement for key %s in specified obj %j for ' +
			'predicate %j', field, obj, x)));

	    x[key][0] = obj[field];
	}, pred);
}

exports.caPredReplaceFields = caPredReplaceFields;

/*
 * Determines whether a predicate has expressions that need to evaluated.
 *
 * Input:
 *  - The predicate to evaluate
 * Output:
 *  - True if this predicate is not trivial, false otherwise
 */
function caPredNonTrivial(pred)
{
	return (!mod_ca.caIsEmpty(pred));
}

exports.caPredNonTrivial = caPredNonTrivial;

/*
 * Iterates over the predicates and returns the list of fields that are at the
 * leaves in the predicate. The list will not contain duplicates.
 *
 * Input:
 *  - pred: The predicate to extract the fields from.
 *
 * Return:
 *  - The list of fields used in the predicate without duplicates.
 */
function caPredFields(pred)
{
	var ret = [];

	caPredWalk(function (x, key) {
		var ii;
		var field = x[key][0];
		var found = false;

		for (ii = 0; ii < ret.length; ii++) {
			if (field == ret[ii]) {
				found = true;
				break;
			}
		}

		if (!found)
			ret.push(field);
	}, pred);

	return (ret);
}

exports.caPredFields = caPredFields;
