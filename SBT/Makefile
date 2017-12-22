
ALL:	bundle/bidUtil.js   \
	bundle/ether.js     \
	fake

bundle/ether.js: src/ether.js
	browserify src/ether.js -o bundle/ether.js

bundle/bidUtil.js: src/bidUtil.js bundle/ether.js
	browserify src/bidUtil.js -o bundle/bidUtil.js

fake:	bundle/bidUtil.js bundle/ether.js
	./set_timestamp.sh
