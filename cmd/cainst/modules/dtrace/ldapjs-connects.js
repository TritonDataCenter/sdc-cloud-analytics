/*
 * DTrace metric for ldap.js connections
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'ldapjs',
    stat: 'connections',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs', 'raddr' ],
    metad: {
	probedesc: [ {
		probes: [ 'ldapjs*:::server-connection' ],
		aggregate: {
			default: 'count()',
			hostname: 'count()',
			zonename: 'count()',
			pid: 'count()',
			execname: 'count()',
			psargs: 'count()',
			raddr: 'count()'
		},
		transforms: {
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs',
			raddr: 'copyinstr(arg0)'
		}
	} ],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
