<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# sdc-cloud-analytics

This repository is part of the Joyent SmartDataCenter project (SDC).  For 
contribution guidelines, issues, and general documentation, visit the main
[SDC](http://github.com/joyent/sdc) project page.

Cloud Analytics is the component of SDC that supports dynamic instrumentation of
the datacenter.  It comprises a distributed service for enabling telemetry and
aggregating data, an agent for reporting data to the aggregating service, and a
frontend visualizer (called [fishbulb](https://github.com/joyent/fishbulb) and
developed separately).

This component is quite old and is not actively developed.  For details on
working on it, see docs/dev.restdown.
