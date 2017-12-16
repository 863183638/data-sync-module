var request = require('request');
var path = require('path');
var fs = require('fs');
var os = require('os');
var crontab = require('node-crontab'); //用于定时任务
var EventEmitter = require('events').EventEmitter;
var ee = new EventEmitter();
var dataHandler = require('./dataHandler'); //数据处理方法
var deepExtend = require('./lib/deep-extend'); //对象深度克隆
function Config () {
    this.option = {
        retryTimes: 2 //默认请求重试次数
    };
    this.configArr = []; //配置请求名数组
    this.requestInfo = {}; //配置请求详细信息
    this.config = {}; //存放标准形式的配置对象
    this.configRemote = []; //存放原始的配置对象
}

Config.prototype = {
    start(option){ //开始请求配置
        try {
            this.env = dataHandler.stringToObj(fs.readFileSync('xxxxxxx', 'utf-8'));
        } catch (err) { //若本地没有环境文件,使用默认配置
            console.log('未找到环境配置,使用本地配置');
            this.config = [];
            for (var i = 0; i < option.configInfo.length; i ++) {
                this.config.push(option.configInfo[i].defaultValue);
            }
            dataHandler.simpleClone(this.config[1],this.config[0]);
            ee.emit('success', this.config, this.configRemote); //触发成功事件
            return;
        }
        this.option = deepExtend(option,this.option);
        for (var i = 0; i < this.option.configInfo.length; i++) {
            this.configArr[i] = this.option.configInfo[i].name;
            this.requestInfo[this.configArr[i]] = {
                retry: 0,
                version: this.option.configInfo[i].version ? this.option.configInfo[i].version : 'default',
                tempPath: path.join(this.env['path'], 'nodejs', this.configArr[i], this.env['env'], this.option.configInfo[i].version ? this.option.configInfo[i].version : 'default', 'configTemp.json'),
                defaultValue: this.option.configInfo[i].defaultValue || {}
            };
        }
        /*
        *   数据处理完毕后,开始进行数据请求
        * */
        this.init(this.configArr);
        var jobId = crontab.scheduleJob("*/15 * * * * *", function (that) {  //轮询
            that.init(that.configArr);
        }, [this]);
    },
    init(arr){
        var _this = this;
        var promiseArr = []; //请求promise数组
        for (var i = 0; i < arr.length; i++) {
            (function (i) {
                var promise = new Promise(function (resolve, reject) {
                    requestSend(arr[i], _this, resolve);  //发送配置请求
                });
                promiseArr.push(promise);
            })(i);
        }
        Promise.all(promiseArr).then(function (data) {  //全部请求完成后 数据整合
            if (!data) {
                return;
            }
            for (var i = 0; i < _this.configArr.length; i++) { // 按数组默认顺序处理
                for (var j = 0; j < data.length; j++) {
                    if (data[j] && _this.configArr[i] == data[j].name) {
                        deepExtend(_this.requestInfo[data[j].name].defaultValue, data[j].config);//深拷贝返回的标准数据对象
                        if(i === 0 && data[0] && data[1]) {
                            deepExtend(_this.requestInfo[_this.configArr[1]].defaultValue,_this.requestInfo[data[j].name].defaultValue);
                        }
                        deepExtend(_this.configRemote[j], data[j].origin);//深拷贝原始返回数据
                    }
                }
            }
            ee.emit('success', _this.config, _this.configRemote); //触发成功事件
        }).catch(function(e) {
            console.log(e);
        });
    },
    getAll(){ //获取完整的配置数据
        return this.config;
    },
    get(name, type){ //获取完整的配置数据的相应字段,以 . 区分层级
        var arr = name.split('.');
        var data = this.config;
        for (var i = 0; i < arr.length; i++) {
            data = data[arr[i]];
        }
        if (type) { //必要时进行类型转换
            switch (type) {
                case 'number' :
                    return Number(data);
                    break;
                case 'boolean':
                    return stringToBoolean(data);
            }
        } else {
            return data;
        }
    },
    on(name, cb){
        ee.on(name, cb);
    },
    once(name, cb){
        ee.once(name, cb);
    }
};

function makeDir (dirpath, mode, callback) { //递归创建文件夹
    fs.exists(dirpath, function (exists) {
        if (exists) {
            callback(dirpath);
        } else {
            //尝试创建父目录，然后再创建当前目录
            makeDir(path.dirname(dirpath), mode, function () {
                fs.mkdir(dirpath, mode, callback);
            });
        }
    });
}
function stringToBoolean (string) {
    return string == 'true';
}

function requestSend (moduleName, _this, resolve) {
    request.post({ //发送请求
        url: _this.env['server'],
        form: {
            module: moduleName, //配置项目名
            profile: _this.env['env'], //配置环境
            version: _this.requestInfo[moduleName].version //配置版本
        }
    }, function (err, httpResponse, body) {
        if (err || httpResponse.statusCode !== 200) {  //请求失败
            if (_this.requestInfo[moduleName].retry < _this.option.retryTimes) {
                _this.requestInfo[moduleName].retry++;
                requestSend(moduleName, _this, resolve);
                return;
            }
            //重试两次后,直接读取缓存配置文件
            if (!_this.requestInfo[moduleName].Data) {
                //无缓存数据时,进行读取
                fs.readFile(_this.requestInfo[moduleName].tempPath, 'utf-8', function (err, data) {
                    if (err) {
                        throw err;
                    }
                    _this.requestInfo[moduleName].retry = 0; //重置请求次数
                    _this.requestInfo[moduleName].Data = data; //添加缓存数据
                    requestSuccess(moduleName, data, resolve);
                });
                return;
            }
            //已经有配置缓存数据,直接进行返回
            _this.requestInfo[moduleName].retry = 0; //重置请求次数
            requestSuccess(moduleName, _this.requestInfo[moduleName].Data, resolve);
            return;
        }
        // 请求成功
        if (httpResponse.headers['x-config-status'] === 'FOUND') {
            //  配置数据有更新
            body = body.replace(/\$\{env\}/g,_this.env['env']); // 自定义环境替换
            _this.requestInfo[moduleName].retry = 0; //重置请求次数
            _this.requestInfo[moduleName].Data = body;
            requestSuccess(moduleName, body, resolve);
            //写入最新的配置数据到缓存文件
            fs.writeFile(_this.requestInfo[moduleName].tempPath, body, function (err) {
                if (err) {
                    makeDir(path.join(_this.env['path'], 'nodejs', moduleName, _this.env['env'], _this.requestInfo[moduleName].version), null, function () {
                        fs.writeFile(_this.requestInfo[moduleName].tempPath, body, function (err) {
                            if (err)
                                throw err;
                            // console.log('success dir');
                        });
                    });
                }
            });
            // console.log(_this.config);
            return;
        }
        if(httpResponse.headers['x-config-status'] === 'NOT_FOUND') {
            throw(new Error('请求配置失败,请确认对应的配置项目是否存在!'));
        }
        resolve();
        // 配置数据无更新
    })
}

function requestSuccess (name, data, resolve) {
    resolve({
        name: name,
        config: dataHandler.dataToObj(JSON.parse(data).items),
        origin: dataHandler.originObj(JSON.parse(data).items)
    });
}
module.exports = new Config();