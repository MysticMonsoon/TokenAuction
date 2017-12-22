#!/bin/bash
now=$(date +%s)
sed -i "s/_TIMESTAMP_[^_]*_/_TIMESTAMP_${now}_/" submitBid
sed -i "s/_TIMESTAMP_[^_]*_/_TIMESTAMP_${now}_/" executeBid
rm bundle/*_TIMESTAMP_*
cp bundle/bidUtil.js bundle/bidUtil_TIMESTAMP_${now}_.js
cp bundle/ether.js bundle/ether_TIMESTAMP_${now}_.js
