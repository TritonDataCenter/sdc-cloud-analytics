/*
 * DTrace metric for Manta tasks dispatched
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'mantaop',
    stat: 'tasks_dispatched',
    fields: [ 'hostname', 'zonename', 'jobid' ],
    metad: {
	probedesc: [ {
	    probes: [ 'marlin-supervisor*:::task-dispatched' ],
	    aggregate: {
		default: 'count()',
		hostname: 'count()',
		zonename: 'count()',
		jobid: 'count()'
	    },
	    transforms: {
		hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
		zonename: 'zonename',
		jobid: 'copyinstr(arg0)'
	    }
	} ],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
