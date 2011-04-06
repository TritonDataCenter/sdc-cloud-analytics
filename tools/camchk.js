/*
 * camtchk: tool to validate and examine metric metadata
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;
var mod_sys = require('sys');
var mod_fs = require('fs');

var mod_ca = require('../lib/ca/ca-common');
var mod_metric = require('../lib/ca/ca-metric');
var mod_md = require('../lib/ca/ca-metadata');

var cpUsageMessage = [
    'usage: camchk <filename>',
    '',
    '    Validate metric metadata.'
].join('\n');

var filename;

function main(argv)
{
	if (argv.length < 1)
		usage('no filename specified');

	filename = argv[0];
	mod_md.caMetadataLoadFile(filename, metadata_loaded);
}

function metadata_loaded(err, metadata)
{
	var md;

	if (err)
		throw (err);

	md = new mod_metric.caMetricMetadata();

	try {
		md.addFromHost(metadata, filename);
		md.report(process.stdout);
		console.log('%s okay', filename);
	} catch (ex) {
		if (!(ex instanceof caError) || ex.code() != ECA_INVAL)
			throw (ex);

		console.log(caSprintf('%s', ex.message));
		console.log('%s has problems', filename);
		process.exit(1);
	}
}

function usage(err)
{
	var msg = '';

	if (err)
		msg += 'error: ' + err + '\n';

	msg += cpUsageMessage;
	fail(msg);
}

function fail(message)
{
	process.stderr.write(message + '\n');
	process.exit(1);
}

main(process.argv.slice(2));
