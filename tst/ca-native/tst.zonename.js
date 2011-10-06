/*
 * Tests the ca-native zone related functions.
 */

var mod_assert = require('assert');
var mod_child = require('child_process');
var mod_ca = require('../../lib/ca/ca-common');
var mod_tl = require('../../lib/tst/ca-test');
var mod_native = require('ca-native');

var g_zone, g_zid;

/*
 * Invoke the zonename utlility to get our zonename and zoneid.
 *
 * Note that we only are looking at the first entry that comes back from zoneadm
 * list. This is purposeful because all we care about is that we can validate
 * the properties about some zone. In a local zone the only entry that we'll see
 * is our own. In the global zone, we'll be able to see many, but the test
 * doesn't rely on the zone we're looking at to be our zone, just one that we
 * can get information about. This ensures that the test always works,
 * regardless of where you're running the tests.
 */
function getZonename()
{
	var stdout, child;
	stdout = '';

	child = mod_child.spawn('zoneadm', [ 'list', '-p' ]);
	child.stdout.on('data', function (data) {
	    stdout += data.toString();
	});

	/* no-op */
	child.stderr.on('data', function (data) {
	});

	child.on('exit', function (code) {
		var split;
		if (code !== 0) {
			mod_tl.ctStdout.error(caSprintf('zoneadm exited ' +
			    'with non-zero status: %d', code));
			process.exit(1);
		}
		split = stdout.split(':');
		mod_assert.ok(split.length > 2);
		g_zid = parseInt(split[0], 10);
		g_zone = split[1];
		mod_tl.advance();
	});

}

function testSuccess()
{
	var zonename = mod_native.zoneNameById(g_zid);
	mod_assert.equal(g_zone, zonename,
	    caSprintf('%s != %s', g_zone, zonename));
	mod_tl.advance();
}

function testFailure()
{
	mod_assert.throws(function () {
		mod_native.zoneNameById();
	});
	mod_assert.throws(function () {
		mod_native.zoneNameById(-1);
	});
	mod_assert.throws(function () {
		mod_native.zoneNameById('foobar');
	});
	mod_assert.throws(function () {
		mod_native.zoneNameById(g_zid, 'foobar');
	});
	mod_tl.advance();
}

/*
 * It's reasonble that this test should only take ten seconds. We end up doing
 * very little actual work.
 */
mod_tl.ctSetTimeout(10 * 1000);
mod_tl.ctPushFunc(getZonename);
mod_tl.ctPushFunc(testSuccess);
mod_tl.ctPushFunc(testFailure);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
