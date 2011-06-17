/*
 * A bunch of utilities to generate D scripts and commonize various tasks
 */

/*
 * Given an array of single predicates, generates an array of them in proper D
 * given a specified D operator to join them.
 */
function dUtilPredFromArray(preds, op)
{
	var mpr = preds.map(function (x) { return ('(' + x + ')'); });
	return ('(' + mpr.join(' ' + op + ' ') + ')');
}

/*
 * An array of predicates to join
 */
function dUtilAndPredArray(preds)
{
	return (dUtilPredFromArray(preds, '&&'));
}

exports.dUtilAndPredArray = dUtilAndPredArray;

/*
 * An array of predicates to or together
 */
function dUtilOrPredArray(preds)
{
	return (dUtilPredFromArray(preds, '||'));
}

exports.dUtilOrPredArray = dUtilOrPredArray;

/*
 * Generates a pragma
 */
function dUtilGeneratePragma(optname, optval)
{
	return (caSprintf('#pragma D option %s=%s', optname, optval));
}

exports.dUtilGeneratePragma = dUtilGeneratePragma;

/*
 * Generates the full predicate expression from an array of strings which are
 * predicates.
 */
function dUtilGeneratePredicate(preds)
{
	return ('/' + dUtilAndPredArray(preds) + '/');
}

exports.dUtilGeneratePredicate = dUtilGeneratePredicate;

/*
 * Generates an aggregation using index to index into it and value to be the
 * aggregation function.
 */
function dUtilGenerateAggregate(index, value)
{
	return (caSprintf('\t@%s = %s;\n', index, value));
}

exports.dUtilGenerateAggregate = dUtilGenerateAggregate;

/*
 * Given a variable name, generates the D to zero that variable out.
 */
function dUtilZeroVariable(varname)
{
	return (caSprintf('\t%s = 0;\n', varname));
}

exports.dUtilZeroVariable = dUtilZeroVariable;
