#!/usr/bin/bash

set -o xtrace

function fatal
{
	echo "${npm_package_name} postactivate: fatal error: $*"
	exit 1
}

#
# This is a little grotty, but we're going to reach into cabase (via our
# dependencies) and pull the manifest into the SMF directory -- processing
# it along the way to reflect the path of both cabase and the directory in
# which we're being installed.
#
svc=${npm_package_name}
manifest=${svc}.xml
pkg=${npm_config_prefix}/lib/node_modules/${npm_package_name}
cabase=${npm_config_prefix}/lib/node_modules/cabase

#
# cainstsvc, being a global zone service, must deliver its manifest into the
# appropriate SMF configuration directory.  The other services, being local
# zone services, need not deliver the manifest at all, but we still need to
# process and import it, so we stick it in /tmp.
#
smfdir=${npm_config_smfdir}
[[ -n $smfdir ]] || smfdir=/tmp

export CABASE_DIR=$cabase
export BASE_DIR=$npm_config_prefix

if [[ -z $npm_config_prefix ]]; then
	#
	# Because CA-based services can be installed as either agents or
	# in the ca zone in the head-node, fall back to npm_config_smartdc_root
	# if we don't find npm_config_agent_root.
	#
	export BASE_DIR=${npm_config_smartdc_root:-/opt/smartdc}
fi

src=${cabase}/smf/manifest/${manifest}
fmri=$(svccfg inventory $src | grep ':@@INSTANCE_NAME@@' | sed -e s'#:@.*##')

instances=
if [[ $svc = "caaggsvc" ]]; then
	ncpus=$(psrinfo | wc -l)
	for (( ii = 0; ii < ncpus; ii++ )) {
		instances="$instances auto$ii"
	}
else
	instances="default"
fi

for instance in $instances; do
	dest=$smfdir/${svc}-$instance.xml

	sed -e "s#@@CABASE_DIR@@#$CABASE_DIR#g" \
	    -e "s#@@BASE_DIR@@#$BASE_DIR#g" \
	    -e "s#@@INSTANCE_NAME@@#$instance#g" \
	    $src > $dest || fatal "could not process $src to $dest"

	svccfg import $dest || fatal "could not import $dest"
	svcadm enable -s $fmri:$instance || \
	    fatal "could not enable $fmri:$instance"
done

exit 0
