#
# Makefile: top-level makefile
#

#
# Directories
#
BUILD		 = build
DIST		 = $(BUILD)/dist
ROOT		 = $(BUILD)/root
ROOT_CA		 = $(ROOT)/opt/smartdc/ca
TOOLSDIR	 = tools
JS_SUBDIRS	 = cmd lib
SRC		:= $(shell pwd)

#
# Tools
#
BASH		 = bash
CSCOPE		 = cscope
JSL		 = $(TOOLSDIR)/jsl
JSSTYLE		 = $(TOOLSDIR)/jsstyle
XMLLINT		 = xmllint --noout
TAR		 = tar
RMTREE		 = rm -rf
NODE_WAF	:= $(SRC)/deps/node-install/bin/node-waf

#
# Files
#
JSL_CONF_MAIN		 = tools/jsl_support/jsl.conf
JSL_CONF_WEB		 = tools/jsl_support/jsl.web.conf
DEMO_JSFILES		 = demo/basicvis/cademo.js
DEMO_WEBJSFILES		 = demo/basicvis/caflot.js
JS_FILES 		:= $(shell find $(JS_SUBDIRS) -name '*.js')
WEBJS_FILES 		 = $(DEMO_WEBJSFILES)
SMF_DTD 		 = /usr/share/lib/xml/dtd/service_bundle.dtd.1

SMF_MANIFESTS = \
	smf/manifest/smartdc-ca-caconfigsvc.xml 	\
	smf/manifest/smartdc-ca-caaggsvc.xml		\
	smf/manifest/smartdc-ca-cainstsvc.xml

SH_SCRIPTS = \
	smf/method/canodesvc	\
	tools/cadeploy		\
	tools/cadeploy-local

ROOT_DIRS = \
	$(ROOT_CA)						\
	$(ROOT_CA)/cmd						\
	$(ROOT_CA)/cmd/cainst					\
	$(ROOT_CA)/cmd/cainst/modules				\
	$(ROOT_CA)/deps						\
	$(ROOT_CA)/deps/connect					\
	$(ROOT_CA)/deps/connect/connect				\
	$(ROOT_CA)/deps/connect/connect/middleware		\
	$(ROOT_CA)/deps/connect/connect/middleware/session	\
	$(ROOT_CA)/deps/node					\
	$(ROOT_CA)/deps/node-amqp				\
	$(ROOT_CA)/deps/node-heatmap				\
	$(ROOT_CA)/deps/node-libdtrace				\
	$(ROOT_CA)/deps/node-kstat				\
	$(ROOT_CA)/deps/node-png				\
	$(ROOT_CA)/lib						\
	$(ROOT_CA)/lib/ca					\
	$(ROOT_CA)/smf						\
	$(ROOT_CA)/smf/method					\
	$(ROOT_CA)/smf/manifest					\
	$(ROOT_CA)/tools					\

ROOT_FILES = \
	$(JS_FILES:%=$(ROOT_CA)/%)	\
	$(SH_SCRIPTS:%=$(ROOT_CA)/%)	\
	$(SMF_MANIFESTS:%=$(ROOT_CA)/%)

ROOT_DEPFILES := \
	$(ROOT_CA)/deps/node/node				\
	$(ROOT_CA)/deps/node-amqp/amqp.js			\
	$(ROOT_CA)/deps/node-amqp/amqp-definitions-0-8.js	\
	$(ROOT_CA)/deps/node-amqp/promise.js			\
	$(ROOT_CA)/deps/node-heatmap/heatmap.js			\
	$(ROOT_CA)/deps/node-kstat/kstat.node			\
	$(ROOT_CA)/deps/node-libdtrace/libdtrace.node		\
	$(ROOT_CA)/deps/node-png/png.node

CONNECT_FILES := $(shell cd deps/connect/lib && find connect -name '*.js')
ROOT_DEPFILES += $(CONNECT_FILES:%=$(ROOT_CA)/deps/connect/%)

NATIVE_DEPS = \
	deps/node/build/default/node				\
	deps/node-kstat/build/default/kstat.node		\
	deps/node-libdtrace/build/default/libdtrace.node	\
	deps/node-png/build/default/png.node

#
# Targets
#
all: $(SRC)/deps/node-install $(NATIVE_DEPS)

$(SRC)/deps/node-install:
	mkdir -p $(SRC)/deps/node-install

deps/node/build/default/node:
	(cd deps/node && ./configure --prefix=$(SRC)/deps/node-install && make install)

%.node: $(NODE_WAF)
	(cd deps/node-$(*F) && $(NODE_WAF) configure && $(NODE_WAF) build)

#
# "check" targets check syntax for files
#
check-manifests: $(SMF_MANIFESTS)
	$(XMLLINT) --dtdvalid $(SMF_DTD) $(SMF_MANIFESTS)

check-shell: $(SH_SCRIPTS)
	$(BASH) -n $(SH_SCRIPTS)

check-jsl: check-jsl-main check-jsl-web

check-jsl-main:
	$(JSL) --conf=$(JSL_CONF_MAIN) $(JS_FILES) $(DEMO_JSFILES)

check-jsl-web:
	$(JSL) --conf=$(JSL_CONF_WEB) $(WEBJS_FILES)

check-jsstyle:
	$(JSSTYLE) $(JS_FILES) $(DEMO_JSFILES) $(WEBJS_FILES)

check: check-shell check-manifests check-jsstyle check-jsl
	@echo check okay

#
# "xref" target builds the cscope cross-reference
#

cscope.files:
	find deps $(JS_SUBDIRS) $(DEMO_JSFILES) $(DEMO_WEBJSFILES) \
	    -type f -name '*.js' -o -name '*.c' -o \
	    -name '*.cpp' -o -name '*.cc' -o -name '*.h' > cscope.files

xref: cscope.files
	$(CSCOPE) -bqR

.PHONY: cscope.files

#
# "install" target install files into the proto ("root") area
#
install: all install-rootdirs install-rootfiles install-deps

install-rootdirs: $(ROOT_DIRS)

$(ROOT_DIRS):
	mkdir -p $(ROOT_DIRS)

install-rootfiles: $(ROOT_FILES)

$(ROOT_CA)/%: %
	cp $^ $@

install-deps: $(ROOT_DEPFILES)

$(ROOT_CA)/deps/%.js: deps/%.js
	cp $^ $@

$(ROOT_CA)/deps/%.js: deps/connect/lib/%.js
	cp $^ $@

$(ROOT_CA)/deps/connect/%.js: deps/connect/lib/%.js
	cp $^ $@

$(ROOT_CA)/deps/node-heatmap/heatmap.js: deps/node-heatmap/lib/heatmap.js
	cp $^ $@

$(ROOT_CA)/deps/node-png/png.node: deps/node-png/build/default/png.node
	cp $^ $@

$(ROOT_CA)/deps/node-kstat/kstat.node: deps/node-kstat/build/default/kstat.node
	cp $^ $@

$(ROOT_CA)/deps/node-libdtrace/libdtrace.node: deps/node-libdtrace/build/default/libdtrace.node
	cp $^ $@

$(ROOT_CA)/deps/node/node: deps/node-install/bin/node
	cp $^ $@

#
# "dist" target creates tarball from the current root
#
dist: $(DIST) $(DIST)/dist.tar.gz

$(DIST):
	mkdir -p $@

$(DIST)/dist.tar.gz: install
	(cd $(ROOT) && $(TAR) cf - *) | gzip > $(DIST)/dist.tar.gz

#
# "clean" target removes created files -- we currently have none
#
clean:

#
# "dist-clean" target removes installed root and built dependencies
#
dist-clean:
	(cd deps/node-kstat && $(NODE_WAF) distclean)
	(cd deps/node-libdtrace && $(NODE_WAF) distclean)
	(cd deps/node-png && $(NODE_WAF) distclean)
	(cd deps/node && $(MAKE) distclean)
	$(RMTREE) $(BUILD) deps/node-install
