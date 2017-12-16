var _ = require('lodash');
module.exports = {
    dataToObj: function (array) {
        var obj = {};
        for (var i = 0; i < array.length; i++) {
            if(array[i].value.match(/^\[.*\]$/)) {
                try {
                    array[i].value = JSON.parse(array[i].value);
                } catch (e) {
                    console.error(e);
                    continue;
                }
            }
            _.set(obj, array[i].key, array[i].value);
        }
        return obj;
    },
    originObj: function (array) {
        var obj = {};
        for (var i = 0; i < array.length; i++) {
            obj[array[i].key] = array[i].value;
        }
        return obj;
    },
    isEmptyObj: function (obj) {
        for (var n in obj) {
            return false;
        }
        return true;
    },
    stringToObj: function (string) {
        var obj = {};
        var arr = string.split(/\r?\n/);
        for (var i = 0; i < arr.length; i++) {
            var arrTemp = arr[i].split('=');
            if( arrTemp[1] ) {
                obj[arrTemp[0].trim()] = arrTemp[1].trim();
            }
        }
        return obj;
    },
    simpleClone : function(targetObj,oldObj) {
        for(var i in oldObj) {
            if(!targetObj[i]) {
                targetObj[i] = oldObj[i];
            }
        }
    }
};