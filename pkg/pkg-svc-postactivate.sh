#!/usr/bin/bash

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
pkg=${npm_config_root}/.npm/${npm_package_name}/${npm_package_version}
cabase=`echo ${pkg}/dependson/cabase@*/package`

export CABASE_DIR=$cabase
export BASE_DIR=$npm_config_agent_root

if [[ -z $npm_config_agent_root ]]; then
	#
	# Because CA-based services can be installed as either agents or
	# in the ca zone in the head-node, fall back to npm_config_smartdc_root
	# if we don't find npm_config_agent_root.
	#
	export BASE_DIR=${npm_config_smartdc_root:-/opt/smartdc}
fi

src=${cabase}/smf/manifest/${manifest}
dest=${npm_config_smfdir}/${manifest}

sed -e "s#@@CABASE_DIR@@#$CABASE_DIR#g" \
    -e "s#@@BASE_DIR@@#$BASE_DIR#g" \
    $src > $dest || fatal "could not process $src to $dest"

fmri=`svccfg inventory ${dest} | grep ':default'`

svccfg import ${dest} || fatal "could not import ${dest}"
svcadm enable -s $fmri || fatal "could not enable $fmri"

exit 0
