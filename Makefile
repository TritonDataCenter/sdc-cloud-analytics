#
# Makefile: top-level makefile
#

#
# Directories
#
TOOLSDIR=tools
JS_SUBDIRS=cmd lib

#
# Tools
#
JSL=$(TOOLSDIR)/jsl
JSSTYLE=$(TOOLSDIR)/jsstyle

#
# Files
#
JS_FILES= `find $(JS_SUBDIRS) -name '*.js'`

#
# Targets
#
all:
	

check-jsl:
	$(JSL) $(JS_FILES)

check-jsstyle:
	$(JSSTYLE) $(JS_FILES)

check: check-jsstyle check-jsl
