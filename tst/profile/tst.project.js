/*
 * tst.project.js: tests projecting a metric onto a profile
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_tl = require('../../lib/tst/ca-test');
var mod_md = require('../../lib/ca/ca-metadata');
var mod_profile = require('../../lib/ca/ca-profile');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */

function check()
{
	var pp, ret;

	pp = new mod_profile.caProfile({
		name: 'test',
		label: 'test profile',
		metrics: [ {
			module: 'mod1',
			stat: 'stat1',
			fields: [ 'f1', 'f2', 'f3' ]
		}, {
			module: 'mod1',
			stat: 'stat2',
			fields: []
		}, {
			module: 'mod2',
			stat: 'stat1',
			fields: [ 'f21', 'f22' ]
		}, {
			module: 'mod3',
			stat: 'stat9',
			fields: [ 'f21', 'f22' ]
		} ]
	});

	ret = pp.project({
		mod1: {
			label: 'module 1',
			stats: {
				stat1: {
					label: 'stat 1',
					type: 'ops',
					fields: {
						f0: {
							label: 'field 0',
							type: 'string'
						},
						f1: {
							label: 'field 1',
							type: 'string'
						},
						f2: {
							label: 'field 2',
							type: 'latency'
						},
						f3: {
							label: 'field 3',
							type: 'string'
						},
						f4: {
							label: 'field 4',
							type: 'string'
						}
					}
				},
				stat2: {
					label: 'stat 2',
					type: 'ops',
					fields: {
						f31: {
							label: 'field 31',
							type: 'string'
						}
					}
				},
				stat3: {
					label: 'stat 3',
					type: 'ops',
					fields: {
						f41: {
							label: 'field 41',
							type: 'string'
						}
					}
				}
			}
		},
		mod2: {
			label: 'module 2',
			stats: {
				stat1: {
					label: 'stat 1',
					type: 'ops',
					fields: {
						f20: {
							label: 'field 20',
							type: 'string'
						},
						f21: {
							label: 'field 21',
							type: 'string'
						}
					}
				},
				stat2: {
					label: 'stat 2',
					type: 'ops',
					fields: {
						f51: {
							label: 'field 51',
							type: 'string'
						}
					}
				}
			}
		},
		mod3: {
			label: 'module 3',
			stats: {
				stat8: {
					label: 'stat 8',
					type: 'ops',
					fields: {
						f71: {
							label: 'field 71',
							type: 'string'
						}
					}
				}
			}
		}
	});

	mod_assert.deepEqual(ret, {
		mod1: {
			label: 'module 1',
			stats: {
				stat1: {
					label: 'stat 1',
					type: 'ops',
					fields: {
						f1: {
							label: 'field 1',
							type: 'string'
						},
						f2: {
							label: 'field 2',
							type: 'latency'
						},
						f3: {
							label: 'field 3',
							type: 'string'
						}
					}
				},
				stat2: {
					label: 'stat 2',
					type: 'ops',
					fields: {}
				}
			}
		},
		mod2: {
			label: 'module 2',
			stats: {
				stat1: {
					label: 'stat 1',
					type: 'ops',
					fields: {
						f21: {
							label: 'field 21',
							type: 'string'
						}
					}
				}
			}
		}
	});

	mod_tl.advance();
}

mod_tl.ctPushFunc(check);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
