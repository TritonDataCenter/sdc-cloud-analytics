#
# Makefile: top-level makefile
#

#
# Constants
#
CA_VERSION	:= $(shell git symbolic-ref HEAD | \
	nawk -F / '{print $$3}')-$(shell git describe --dirty)
SRC		:= $(shell pwd)
NODEENV		:= $(shell tools/npath)
# As per mountain-gorilla "Package Versioning".
ifeq ($(TIMESTAMP),)
	TIMESTAMP=$(shell date -u "+%Y%m%dT%H%M%SZ")
endif
DIRTY_ARG=--dirty
ifeq ($(IGNORE_DIRTY), 1)
	DIRTY_ARG=
endif
CA_PUBLISH_VERSION := $(shell git symbolic-ref HEAD | \
	nawk -F / '{print $$3}')-$(TIMESTAMP)-g$(shell \
	git describe --all --long $(DIRTY_ARG) | nawk -F '-g' '{print $$NF}')

#
# Directories
#
BUILD		 = build
DIST		 = $(BUILD)/dist
PKGROOT		 = $(BUILD)/pkg

DEMO_DIRS	:= $(shell find demo -type d)
METAD_DIR	 = $(SRC)/cmd/cainst/modules/dtrace/
NODEDIR		:= $(SRC)/deps/node-install/bin
JS_SUBDIRS	 = cmd lib tools
TOOLSDIR	 = tools
TST_SUBDIRS	 = tst
WEBREV		 = $(TOOLSDIR)/webrev_support

#
# Tools
#
BASH		 = bash
CC		 = gcc
CAPROF		 = $(NODEENV) $(NODE) $(TOOLSDIR)/caprof.js
CAMCHK		 = $(NODEENV) $(NODE) $(TOOLSDIR)/camchk.js > /dev/null
CAMD		 = $(NODEENV) $(NODE) $(TOOLSDIR)/camd.js
CSCOPE		 = cscope
JSL		 = $(TOOLSDIR)/jsl
JSSTYLE		 = $(TOOLSDIR)/jsstyle
JSONCHK		 = $(NODEENV) $(NODE) $(TOOLSDIR)/jsonchk.js
NODE		:= $(NODEDIR)/node
NODE_WAF	:= $(NODEDIR)/node-waf
NPM		:= PATH=$(NODEDIR):$$PATH npm
RESTDOWN	 = python2.6 $(SRC)/deps/restdown/bin/restdown
RMTREE		 = rm -rf
TAR		 = tar
XMLLINT		 = xmllint --noout

#
# Files
#
JSL_CONF_MAIN		 = $(TOOLSDIR)/jsl_support/jsl.conf
JSL_CONF_WEB		 = $(TOOLSDIR)/jsl_support/jsl.web.conf

DEMO_FILES		:= $(shell find demo -type f)
DEMO_JSFILES		 = demo/basicvis/cademo.js
DEMO_WEBJSFILES		 = demo/basicvis/caflot.js	\
	demo/basicvis/caadmin.js			\
	demo/basicvis/camon.js
JS_FILES 		:= $(shell find $(JS_SUBDIRS) -name '*.js')
JSON_FILES		:= $(shell find pkg -name '*.json')
METAD_FILES		:= $(shell find $(METAD_DIR) -name '*.js')
METADATA_FILES		:= $(shell find metadata -name '*.json')
RELEASE_TARBALL  	 = $(DIST)/ca-pkg-$(CA_VERSION).tar.bz2
TST_JSFILES		:= $(shell find $(TST_SUBDIRS) -name '*.js')
WEBJS_FILES 		 = $(DEMO_WEBJSFILES)

SMF_DTD 		 = /usr/share/lib/xml/dtd/service_bundle.dtd.1

SMF_MANIFESTS = \
	smf/manifest/caconfigsvc.xml			\
	smf/manifest/caaggsvc.xml			\
	smf/manifest/cainstsvc.xml			\
	smf/manifest/castashsvc.xml

SVC_SCRIPTS = \
	pkg/pkg-svc-postinstall.sh	\
	pkg/pkg-svc-postuninstall.sh

SH_SCRIPTS = \
	pkg/pkg-svc-postinstall.sh	\
	pkg/pkg-svc-postuninstall.sh	\
	smf/method/canodesvc		\
	tools/cabranch			\
	tools/cadeploy			\
	tools/cainstrfleet		\
	tools/caupagent			\
	tools/catest			\
	tools/ca-headnode-setup

#
# Package definitions
#
PKGS		 = cabase caconfigsvc caaggsvc cainstsvc castashsvc
PKG_TARBALLS	 = $(PKGS:%=$(PKGROOT)/%.tar.gz)

PKGDIRS_cabase := \
	$(PKGROOT)/cabase			\
	$(PKGROOT)/cabase/cmd			\
	$(PKGROOT)/cabase/cmd/caagg		\
	$(PKGROOT)/cabase/cmd/caagg/transforms	\
	$(PKGROOT)/cabase/cmd/cainst		\
	$(PKGROOT)/cabase/cmd/cainst/modules	\
	$(PKGROOT)/cabase/cmd/cainst/modules/dtrace	\
	$(DEMO_DIRS:%=$(PKGROOT)/cabase/%)	\
	$(PKGROOT)/cabase/docs			\
	$(PKGROOT)/cabase/lib			\
	$(PKGROOT)/cabase/lib/ca		\
	$(PKGROOT)/cabase/lib/tst		\
	$(PKGROOT)/cabase/metadata		\
	$(PKGROOT)/cabase/metadata/metric	\
	$(PKGROOT)/cabase/metadata/profile	\
	$(PKGROOT)/cabase/pkg			\
	$(PKGROOT)/cabase/smf			\
	$(PKGROOT)/cabase/smf/manifest		\
	$(PKGROOT)/cabase/smf/method		\
	$(PKGROOT)/cabase/tools

PKGFILES_cabase = \
	$(PKGROOT)/cabase/package.json			\
	$(PKGROOT)/cabase/.npmignore			\
	$(PKGROOT)/cabase/cmd/node			\
	$(PKGROOT)/cabase/cmd/cactl.js			\
	$(PKGROOT)/cabase/cmd/ctf2json			\
	$(DEMO_FILES:%=$(PKGROOT)/cabase/%)		\
	$(DOC_FILES:%=$(PKGROOT)/cabase/%)		\
	$(JS_FILES:%=$(PKGROOT)/cabase/%)		\
	$(SH_SCRIPTS:%=$(PKGROOT)/cabase/%)		\
	$(SMF_MANIFESTS:%=$(PKGROOT)/cabase/%)		\
	$(METADATA_FILES:%=$(PKGROOT)/cabase/%)		\
	$(PKGROOT)/cabase/lib/httpd.d			\
	$(PKGROOT)/cabase/lib/node.d			\
	$(PKGROOT)/cabase/tools/nhttpsnoop

DEPS_cabase = \
	amqp		\
	ca-native	\
	connect		\
	ctype		\
	heatmap		\
	kstat		\
	libdtrace	\
	png		\
	uname		\
	libGeoIP

PKGDEPS_cabase = $(DEPS_cabase:%=$(PKGROOT)/cabase/node_modules/%)

PKGDIRS_caconfigsvc := \
	$(PKGROOT)/caconfigsvc/pkg

PKGFILES_caconfigsvc = \
	$(SVC_SCRIPTS:%=$(PKGROOT)/caconfigsvc/%)		\
	$(PKGROOT)/caconfigsvc/package.json

PKGDIRS_caaggsvc := \
	$(PKGROOT)/caaggsvc/pkg

PKGFILES_caaggsvc = \
	$(SVC_SCRIPTS:%=$(PKGROOT)/caaggsvc/%)		\
	$(PKGROOT)/caaggsvc/package.json

PKGDIRS_cainstsvc := \
	$(PKGROOT)/cainstsvc/pkg

PKGFILES_cainstsvc = \
	$(SVC_SCRIPTS:%=$(PKGROOT)/cainstsvc/%)		\
	$(PKGROOT)/cainstsvc/package.json

PKGDIRS_castashsvc := \
	$(PKGROOT)/castashsvc/pkg

PKGFILES_castashsvc = \
	$(SVC_SCRIPTS:%=$(PKGROOT)/castashsvc/%)	\
	$(PKGROOT)/castashsvc/package.json

PKG_DIRS := \
	$(PKGROOT)		\
	$(PKGDIRS_cabase)	\
	$(PKGDIRS_caconfigsvc)	\
	$(PKGDIRS_caaggsvc)	\
	$(PKGDIRS_cainstsvc)	\
	$(PKGDIRS_castashsvc)

NATIVE_DEPS = \
	deps/node/build/default/node				\
	deps/ca-native/build/default/ca-native.node		\
	deps/node-kstat/build/default/kstat.node		\
	deps/node-libdtrace/build/default/libdtrace.node	\
	deps/node-png/build/default/png.node			\
	deps/node-uname/build/default/uname.node		\
	deps/node-libGeoIP/build/default/libGeoIP.node

DOC_FILES = \
	docs/index.html

#
# Targets
#
all: tools release

# XXX don't think we need codereview at all
tools: $(WEBREV)/bin/codereview $(NODEDIR)/node $(NATIVE_DEPS) deps/ctf2json/ctf2json
.PHONY: tools

$(WEBREV)/bin/codereview:
	$(CC) $(WEBREV)/src/lwlp.c -o $(WEBREV)/bin/codereview

$(NODEDIR)/node: deps/node/build/default/node

deps/node/build/default/node: | deps/node/.git deps/node-install
	(cd deps/node && ./configure --with-dtrace \
	    --prefix=$(SRC)/deps/node-install && make install)

deps/node-install:
	mkdir -p deps/node-install

deps/ctf2json/ctf2json:
	(cd deps/ctf2json && $(MAKE))

#
# The "publish" target copies the build bits to the given BITS_DIR.
# This is typically called by an external driver (e.g. CI).
#
publish: $(RELEASE_TARBALL)
	@if [[ -z "$(BITS_DIR)" ]]; then \
		echo "error: 'BITS_DIR' must be set for 'publish' target"; \
		exit 1; \
	fi
	mkdir -p $(BITS_DIR)/ca
	cp $(RELEASE_TARBALL) $(BITS_DIR)/ca/ca-pkg-$(CA_PUBLISH_VERSION).tar.bz2
	cp $(PKGROOT)/cabase.tar.gz $(BITS_DIR)/ca/cabase-$(CA_PUBLISH_VERSION).tar.gz
	cp $(PKGROOT)/cainstsvc.tar.gz $(BITS_DIR)/ca/cainstsvc-$(CA_PUBLISH_VERSION).tar.gz

#
# The "release" target creates a ca-pkg.tar.bz2 suitable for release to the
# head-node. To formally release this, it should be copied to the build server
# as follows:
#
#    scp build/dist/ca-pkg-*.tar.bz2 \
#	bamboo@10.2.0.190:/rpool/data/coal/live_147/assets
#
# Subsequent head-node builds will then pick up the new release.  (This address
# can only be accessed through the Bellingham VPN, and access via the user
# "bamboo" is exclusively by ssh key.)
#
release: $(RELEASE_TARBALL)

$(RELEASE_TARBALL): $(PKG_TARBALLS) | $(DIST)
	mkdir -p $(BUILD)/root
	[[ -e $(BUILD)/root/pkg ]] || ln -s $(SRC)/$(BUILD)/pkg $(BUILD)/root/pkg
	(cd $(BUILD) && $(TAR) chf - root/pkg/*.gz) | bzip2 > $@

$(DIST):
	mkdir -p $@

#
# The "pkg" target builds tarballs for each of the npm packages.
#
pkg: $(PKG_TARBALLS)

#
# We have to depend on NATIVE_DEPS here because otherwise "npm bundle install"
# will happily install a dependency package (like node-uname) even though its
# binary hasn't actually been built.  We have to trigger the building of the
# binary.
#
$(PKGROOT)/cabase.tar.gz: $(NATIVE_DEPS) $(PKGFILES_cabase) | $(PKGDEPS_cabase) $(PKG_DIRS)
	(cd $(PKGROOT) && $(TAR) cf - cabase) | gzip > $@

$(PKGROOT)/caconfigsvc.tar.gz: $(PKGFILES_caconfigsvc) | $(PKG_DIRS)
	(cd $(PKGROOT) && $(TAR) cf - caconfigsvc) | gzip > $@

$(PKGROOT)/caaggsvc.tar.gz: $(PKGFILES_caaggsvc) | $(PKG_DIRS)
	(cd $(PKGROOT) && $(TAR) cf - caaggsvc) | gzip > $@

$(PKGROOT)/cainstsvc.tar.gz: $(PKGFILES_cainstsvc) | $(PKG_DIRS)
	(cd $(PKGROOT) && $(TAR) cf - cainstsvc) | gzip > $@

$(PKGROOT)/castashsvc.tar.gz: $(PKGFILES_castashsvc) | $(PKG_DIRS)
	(cd $(PKGROOT) && $(TAR) cf - castashsvc) | gzip > $@

$(PKGFILES_cabase) $(PKGFILES_caconfigsvc) $(PKGFILES_caaggsvc) $(PKGFILES_cainstsvc) $(PKGFILES_castashsvc): | $(PKG_DIRS)

$(PKG_DIRS):
	mkdir -p $(PKG_DIRS)

$(PKGROOT)/cabase/node_modules/%: $(NODE) | deps/%/.git
	cd $(PKGROOT)/cabase && $(NPM) install $(SRC)/deps/$*
	cd $(PKGROOT)/cabase/node_modules/$* && (echo '!./build'; echo '!./node_modules') >> .npmignore

$(PKGROOT)/cabase/node_modules/%: $(NODE) | deps/node-%/.git
	cd $(PKGROOT)/cabase && $(NPM) install $(SRC)/deps/node-$*
	cd $(PKGROOT)/cabase/node_modules/$* && (echo '!./build'; echo '!./node_modules') >> .npmignore

deps/%/.git: | deps/%
	git submodule update --init

$(PKGROOT)/cabase/cmd/node: deps/node/node
	cp $^ $@

$(PKGROOT)/cabase/lib/httpd.d: lib/httpd.d
	cp $^ $@

$(PKGROOT)/cabase/lib/node.d: lib/node.d
	cp $^ $@

$(PKGROOT)/cabase/%: %
	cp $^ $@

$(PKGROOT)/caconfigsvc/%: %
	cp $^ $@

$(PKGROOT)/caaggsvc/%: %
	cp $^ $@

$(PKGROOT)/cainstsvc/%: %
	cp $^ $@

$(PKGROOT)/castashsvc/%: %
	cp $^ $@

$(PKGROOT)/%/package.json: pkg/%-package.json FORCE
	sed -e 's#@@CA_VERSION@@#$(CA_VERSION)#g' $< > $@

$(PKGROOT)/%/.npmignore: pkg/npm-ignore
	grep -v ^# $^ > $@


$(PKGROOT)/cabase/cmd/ctf2json: deps/ctf2json/ctf2json
	cp $^ $@

.SECONDEXPANSION:
%.node: | deps/node-$$(*F)/.git
	(cd deps/node-$(*F) && $(NODE_WAF) configure && $(NODE_WAF) build)

deps/ca-native/build/default/ca-native.node:
	cd deps/ca-native && $(NODE_WAF) configure && $(NODE_WAF) build

#
# The "check" target checks the syntax of various files.
#
check: check-metadata check-metad check-shell check-manifests check-jsstyle \
    check-jsl check-json
	@echo check okay

check-metadata: tools $(METADATA_FILES:%=%.check)

check-metad: tools
	$(CAMD) $(METAD_FILES)

metadata/profile/%.json.check: metadata/profile/%.json tools
	$(CAPROF) $<

metadata/metric/%.json.check: metadata/metric/%.json tools
	$(CAMCHK) $<

check-manifests: $(SMF_MANIFESTS)
	$(XMLLINT) --dtdvalid $(SMF_DTD) $(SMF_MANIFESTS)

check-shell: $(SH_SCRIPTS) tools/recreate-zone
	$(BASH) -n $(SH_SCRIPTS) tools/recreate-zone

check-jsl: check-jsl-main check-jsl-web

check-jsl-main: tools $(JS_FILES) $(DEMO_JSFILES) $(TST_JSFILES)
	$(JSL) --conf=$(JSL_CONF_MAIN) $(JS_FILES) $(DEMO_JSFILES) $(TST_JSFILES)

check-jsl-web: tools $(WEBJS_FILES)
	$(JSL) --conf=$(JSL_CONF_WEB) $(WEBJS_FILES)

check-jsstyle: tools $(JS_FILES) $(DEMO_JSFILES) $(WEBJS_FILES) $(TST_JSFILES)
	$(JSSTYLE) $(JS_FILES) $(DEMO_JSFILES) $(WEBJS_FILES) $(TST_JSFILES)

check-json: $(JSON_FILES:%=%.check)

%.json.check: %.json tools
	$(JSONCHK) $<

#
# The "test" target runs catest.
#
test: release
	tools/catest -a

#
# The "pbchk" target runs pre-push checks.
#
pbchk: check test

#
# The "xref" target builds the cscope cross-reference.
#
xref: cscope.files
	$(CSCOPE) -bqR

cscope.files:
	find deps \
	    $(JS_SUBDIRS) $(DEMO_JSFILES) $(DEMO_WEBJSFILES) $(TST_SUBDIRS) \
	    -type f -name '*.js' -o -name '*.c' -o \
	    -name '*.cpp' -o -name '*.cc' -o -name '*.h' > cscope.files

.PHONY: cscope.files

#
# The "doc" target builds docs HTML from restdown.
#
doc: $(DOC_FILES)

docs/%.html: docs/%.restdown
	$(RESTDOWN) $<

#
# The "clean" target removes created files -- we currently have none
#
clean:
	-rm -f $(DOC_FILES)
	-rm -f $(WEBREV)/bin/codereview 

#
# "distclean" target removes installed root and built dependencies
#
distclean: clean
	-(cd deps/node-kstat && $(NODE_WAF) distclean)
	-(cd deps/node-libdtrace && $(NODE_WAF) distclean)
	-(cd deps/node-png && $(NODE_WAF) distclean)
	-(cd deps/node-uname && $(NODE_WAF) distclean)
	-(cd deps/node-libGeoIP && $(NODE_WAF) distclean)
	-(cd deps/node && $(MAKE) distclean)
	-(cd deps/ctf2json && $(MAKE) clean)
	-(cd deps/ca-native && $(NODE_WAF) distclean)
	-$(RMTREE) $(BUILD) deps/node-install

#
# "FORCE" target is used as a dependency to require a given target to run every
# time.  This should rarely be necessary.
#
FORCE:

.PHONY: FORCE
