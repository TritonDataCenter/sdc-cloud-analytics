CFLAGS = -Wall
CPPFLAGS += -Iv8
SOLDFLAGS = -shared -fPIC

all: mdb_v8.so

mdb_v8.so: mdb_v8.c
	$(CC) $(CPPFLAGS) $(CFLAGS) $(SOLDFLAGS) -o $@ $^

clean:
	-rm -f mdb_v8.so
