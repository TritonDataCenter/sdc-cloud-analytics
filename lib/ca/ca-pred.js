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
var ASSERT = require('assert').ok;

/*
 * A mapping from a predicate key to the type specific parsing routine.  Any
 * change to the set of possible initial keys must update these data structures
 * as well as caPredEvaluate().
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

keyFields['lt'][mod_ca.ca_field_arity_numeric] = true;
keyFields['lt'][mod_ca.ca_field_arity_discrete] = false;
keyFields['le'][mod_ca.ca_field_arity_numeric] = true;
keyFields['le'][mod_ca.ca_field_arity_discrete] = false;
keyFields['gt'][mod_ca.ca_field_arity_numeric] = true;
keyFields['gt'][mod_ca.ca_field_arity_discrete] = false;
keyFields['ge'][mod_ca.ca_field_arity_numeric] = true;
keyFields['ge'][mod_ca.ca_field_arity_discrete] = false;
keyFields['eq'][mod_ca.ca_field_arity_numeric] = true;
keyFields['eq'][mod_ca.ca_field_arity_discrete] = true;
keyFields['ne'][mod_ca.ca_field_arity_numeric] = true;
keyFields['ne'][mod_ca.ca_field_arity_discrete] = true;

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
		throw (new caInvalidFieldError('predicate', pred,
		    mod_ca.caSprintf('found too many keys: %d. expected one',
		    keysFound)));

	if (keysFound < 1)
		throw (new caInvalidFieldError('predicate', pred,
		    'predicate is missing a key'));

	return (key);
}

/*
 * Validates that the predicate has a valid format for relational predicates.
 * That means that it fits the format:
 * { key: [ field, constant ] }
 *
 * Input:
 *  - pred: The predicate
 *  - key: The key that we're interested in
 *
 * On return the following points have been validated:
 *  - That the key points to a two element array
 *  - That the first field is a valid type
 */
function caPredValidateRel(pred, key)
{
	var field, constant;

	if (!pred[key])
		throw (new caInvalidFieldError('predicate', pred,
		    mod_ca.caSprintf('predicate is missing key %j', key)));

	if (!(pred[key] instanceof Array))
		throw (new caInvalidFieldError('predicate', pred,
		    'predicate key does not point to an array'));

	if (pred[key].length != 2)
		throw (new caInvalidFieldError('predicate', pred,
		    mod_ca.caSprintf('predicate key ' +
		    'does not point to an array of two elements: found %d ' +
		    'elements', pred[key].length)));

	field = pred[key][0];
	constant = pred[key][1];

	if (typeof (field) != 'string')
		throw (new caInvalidFieldError('predicate', pred,
		    mod_ca.caSprintf('predicate field is not a string: ' +
		    'got %j.', field)));

	if (typeof (constant) != 'number' && typeof (constant) != 'string')
		throw (new caInvalidFieldError('predicate', pred,
		    mod_ca.caSprintf('predicate constant is not a constant: ' +
		    'got %j.', constant)));
}

/*
 * This function assumes that we have a syntactically valid object and the
 * caller has already established that the only fields present are fields which
 * are "valid". We now go through and do checks to validate that fields are used
 * appropriately given their arities (as specified in "fieldarities").
 *
 *  Input:
 *   - fieldarities: valid fields for the metric and their arities
 *   - pred: The relational predicate to validate
 *   - key: The key that we are interested in validating
 */
function caPredValidateField(fieldarities, pred, key)
{
	var field, constant, arity;

	field = pred[key][0];
	constant = pred[key][1];

	ASSERT(field in fieldarities);
	arity = fieldarities[field];
	ASSERT(arity in keyFields[key]);

	if (arity == mod_ca.ca_field_arity_numeric &&
	    typeof (constant) != 'number')
		throw (new caInvalidFieldError('predicate', pred,
		    mod_ca.caSprintf('predicate field ' +
		    'is of type numeric, but the constant is not a number: ' +
		    'got type %s', typeof (constant))));

	if (arity != mod_ca.ca_field_arity_numeric &&
	    typeof (constant) != 'string')
		throw (new caInvalidFieldError('predicate', pred,
		    mod_ca.caSprintf('predicate field ' +
		    'is of type discrete, but the constant is not a string: ' +
		    'got type %s', typeof (constant))));
}

/*
 * Validates that the logical expression has a valid format. This means that it
 * is of the format:
 * { key: [ obj, obj,... ] }
 *
 * Input:
 *  - pred: The current predicate
 *  - key: The key that we're interested in
 *
 * On Return the following points have been validated:
 *  - The key points to an array of at least length two
 *  - Every object in the array is a valid predicate or logical expression
 */
function caPredValidateLog(pred, key)
{
	var ii;

	if (!pred[key])
		throw (new caInvalidFieldError('predicate', pred,
		    mod_ca.caSprintf('logical expr is ' +
		    'missing key %j', key)));

	if (!(pred[key] instanceof Array))
		throw (new caInvalidFieldError('predicate', pred,
		    mod_ca.caSprintf('logical expr key does not point to ' +
		    'an array')));

	if (pred[key].length < 2)
		throw (new caInvalidFieldError('predicate', pred,
		    mod_ca.caSprintf('logical expr ' +
		    'key does not contain enough elements: found %d, ' +
		    'expected at least two',
		    pred[key].length)));

	for (ii = 0; ii < pred[key].length; ii++)
		caPredValidateSyntax(pred[key][ii]);
}

/*
 * This is the entry point for validating and parsing any given predicate. This
 * will be called when beginning to parse any specific predicate.
 *
 * Input:
 *  - pred: The predicate that we want to validate
 *
 * Output: None on success, an exception is thrown on error.
 */
function caPredValidateSyntax(pred)
{
	var key;

	if (!(pred instanceof Object))
		throw (new caInvalidFieldError('predicate', pred,
		    'predicate must be an object'));

	if (!caPredNonTrivial(pred))
		return;

	key = caPredGetKey(pred);
	if (!(key in parseFuncs))
		throw (new caInvalidFieldError('predicate', pred,
		    mod_ca.caSprintf('invalid key: %s', key)));

	parseFuncs[key](pred, key);
}

exports.caPredValidateSyntax = caPredValidateSyntax;

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
 * Validates the semantic properties of the predicate. This includes making sure
 * that every field is valid for the predicate and the values present match the
 * expected arity.
 */
function caPredValidateSemantics(fieldarities, pred)
{
	var func = function (ent, key) {
	    return (caPredValidateField(fieldarities, ent, key));
	};

	caPredWalk(func, pred);
}

exports.caPredValidateSemantics = caPredValidateSemantics;

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
		ASSERT(false, mod_ca.caSprintf('Expected only ' +
		    'one key for the specified predicate. Found %d. Looking ' +
		    'at predicate %j', keysFound, pred));

	if (!printFuncs[key])
		ASSERT(false, mod_ca.caSprintf('Missing print ' +
		    'function for key %s. Looking at predicate %j', key,
		    pred));

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
		    ASSERT(false, mod_ca.caSprintf('Cannot find ' +
			'replacement for key %s in specified obj %j for ' +
			'predicate %j', field, obj, x));

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

/*
 * Given a predicate and an object mapping key names to values, return whether
 * the predicate is satisfied by the specified fields.
 */
function caPredEval(pred, values)
{
	var expr;

	if (!caPredNonTrivial(pred))
		return (true);

	ASSERT(pred);
	ASSERT(pred instanceof Object);
	expr = caDeepCopy(pred);
	caPredReplaceFields(values, expr);
	return (caPredEvalExpr(expr));
}

exports.caPredEval = caPredEval;

function caPredEvalExpr(expr)
{
	var key, ii;

	key = caPredGetKey(expr);

	switch (key) {
	case 'and':
		for (ii = 0; ii < expr['and'].length; ii++) {
			if (!caPredEvalExpr(expr['and'][ii]))
				return (false);
		}

		return (true);

	case 'or':
		for (ii = 0; ii < expr['or'].length; ii++) {
			if (caPredEvalExpr(expr['or'][ii]))
				return (true);
		}

		return (false);

	case 'lt':
	case 'le':
	case 'gt':
	case 'ge':
		ASSERT(typeof (expr[key][0]) == 'number');
		ASSERT(typeof (expr[key][1]) == 'number');
		/*jsl:fallthru*/
	default:
		ASSERT(key in caPredEvalHelpers);
		ASSERT(expr[key].length == 2);
		break;
	}

	return (caPredEvalHelpers[key](expr[key][0], expr[key][1]));
}

var caPredEvalHelpers = {
	lt: function (a, b) { return (a <  b); },
	le: function (a, b) { return (a <= b); },
	gt: function (a, b) { return (a >  b); },
	ge: function (a, b) { return (a >= b); },
	eq: function (a, b) { return (a == b); },
	ne: function (a, b) { return (a != b); }
};
