/*
 * tst.error_stacktrace.js: test the built-in stacktrace for caError and Error
 */

var mod_ca = require('../../lib/ca/ca-common.js');

function stack1(func)
{
	return (func());
}

function stack2()
{
	var cause = stack3();
	return (new caError(ECA_INVAL, cause, 'you did something wrong'));
}

function stack3()
{
	return (new caError(ECA_REMOTE, null, 'arbitrary remote error'));
}

function stack4()
{
	return (new Error('generic V8 error'));
}

/*
 * We wrap this in a setTimeout call so that the stacktrace contains as few
 * of node's internal frames as possible to minimize having to update the stdout
 * file across node releases.  We include several of our own frames to ensure
 * that they appear in the stacktrace.
 */
setTimeout(function () {
	var exn, re;

	re = new RegExp(process.env['SRC'], 'g');

	exn = stack1(stack2);
	console.log(caSprintf('%r', exn).replace(re, '...'));

	exn = stack1(stack4);
	console.log(caSprintf('%r', exn).replace(re, '...'));
}, 0);
