/*
 * DTrace metric for Apache http operations
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'apache',
    stat: 'httpd_ops',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs', 'ppid',
	'pexecname', 'ppsargs', 'http_method', 'http_url', 'raddr', 'rport',
	'http_path', 'latency' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'httpd*:::request-start' ],
		gather: {
			latency: {
				gather: 'timestamp',
				store: 'thread'
			}
		}
	    },
	    {
		probes: [ 'httpd*:::request-done' ],
		aggregate: {
			default: 'count()',
			hostname: 'count()',
			zonename: 'count()',
			pid: 'count()',
			execname: 'count()',
			psargs: 'count()',
			ppid: 'count()',
			pexecname: 'count()',
			ppsargs: 'count()',
			http_method: 'count()',
			http_url: 'count()',
			raddr: 'count()',
			rport: 'count()',
			http_path: 'count()',
			latency: 'llquantize($0, 10, 3, 11, 100)'
		},
		transforms: {
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs',
			ppid: 'lltostr(ppid)',
			pexecname: 'curthread->t_procp->p_parent->' +
			    'p_user.u_comm',
			ppsargs:
			    'curthread->t_procp->p_parent->p_user.u_psargs',
			http_method: '(xlate <httpd_rqinfo_t *>' +
			    '((dthttpd_t *)arg0))->rq_method',
			http_url: '(xlate <httpd_rqinfo_t *>' +
			    '((dthttpd_t *)arg0))->rq_uri',
			raddr: '(xlate <conninfo_t *>' +
			    '((dthttpd_t *)arg0))->ci_remote',
			/*
			 * The uint32_t cast works around the fact that DTrace
			 * seems to sign-extend the uint16_t as though it were
			 * actually negative.
			 */
			rport: 'lltostr((uint32_t)((xlate <httpd_rqinfo_t *>' +
			    '((dthttpd_t *)arg0))->rq_rport))',
			http_path: 'strtok((xlate <httpd_rqinfo_t *> (' +
			    '(dthttpd_t *)arg0))->rq_uri, "?")',
			latency: 'timestamp - $0'
		},
		verify: {
			latency: '$0'
		}
	    },
	    {
		probes: [ 'httpd*:::request-done' ],
		clean: {
			latency: '$0'
		}
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
