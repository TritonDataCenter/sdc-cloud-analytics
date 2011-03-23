#!/bin/bash

if [[ `hostname` = 'bh1-autobuild' ]]; then
  pfexec mkdir -p $PUBLISH_LOCATION
  pfexec cp build/pkg/cabase.tar.gz    "$PUBLISH_LOCATION/$CABASE_PKG"
  pfexec cp build/pkg/cainstsvc.tar.gz "$PUBLISH_LOCATION/$CAINSTSVC_PKG "
else
  echo "Not publishing because not on bh1-autobuild"
fi
