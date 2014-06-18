/**
 * @license Copyright 2013 - 2013 Intel Corporation All Rights Reserved.
 *
 * The source code, information and material ("Material") contained herein is owned by Intel Corporation or its
 * suppliers or licensors, and title to such Material remains with Intel Corporation or its suppliers or
 * licensors. The Material contains proprietary information of Intel or its suppliers and licensors. The
 * Material is protected by worldwide copyright laws and treaty provisions. No part of the Material may be used,
 * copied, reproduced, modified, published, uploaded, posted, transmitted, distributed or disclosed in any way
 * without Intel's prior express written permission. No license under any patent, copyright or other intellectual
 * property rights in the Material is granted to or conferred upon you, either expressly, by implication,
 * inducement, estoppel or otherwise. Any license under such intellectual property rights must be express and
 * approved by Intel in writing.
 *
 * Unless otherwise agreed by Intel in writing, you may not remove or alter this notice or any other notice
 * embedded in Materials by Intel or Intel's suppliers or licensors in any way.
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50, node: true */
/*global  */
(function () {

    "use strict";

    var Q           = require("q"),
        spawn       = require("child_process").spawn,
        cpExec      = require("child_process").exec,
        util        = require("util"),

    /**
     * @constant No error.
     */
        //:TODO: Check error codes
        NO_ERROR = 0,
        FILE_NOT_FOUND = -1,
        CANNOT_RUN_BROWSER = -2;

    var MAC_MDFIND_QUERY    = "mdfind \"kMDItemCFBundleIdentifier == '%s'\"",
        MAC_CODESIGN_QUERY  = "codesign --display \"%s\"",
        MAC_RE_VALUE        = /Executable=(.*)/;

    /**
     * @private
     * An array of opened browser pids.
     */
    var liveBrowserOpenedPIDs = [];

    // The following function is temp for testing, //:TODO: Set and get the appropriate folder
    function getApplicationSupportDirectory() {
        if (process.platform === "win32") {
            return 'c:/TEMP';
        } else if (process.platform === "darwin") {
            return '/Users/username/TEMP';  //:temp replace with your home folder path
        } else if (process.platform === "linux") {
            return '$/users/username/TEMP';
        }
        return null;
    }
    function _findAppByKeyMac(key) {
        var deferred = Q.defer();
        var macMdfindQuery = util.format(MAC_MDFIND_QUERY, key);

        cpExec(macMdfindQuery, null, function (error, stdout, stderr) {
            if (!stdout) {
                deferred.reject(util.format("Could not find application with bundle ID %s", key));
                return;
            } else if (error) {
                deferred.reject(error);
                return;
            }

            var pathToBundle = stdout.trim(),
                macCodesignQuery = util.format(MAC_CODESIGN_QUERY, pathToBundle);

            cpExec(macCodesignQuery, null, function (error, stdout, stderr) {
                var pathToBinary = stderr && stderr.trim(),   // codesign writes to stderr
                    exec = pathToBinary && MAC_RE_VALUE.exec(pathToBinary),
                    path = exec && exec[1];

                if (!path) {
                    error = util.format("Could not find binary in application bundle %s", pathToBundle);
                }
                if (error) {
                    deferred.reject(error);
                } else {
                    deferred.resolve(path);
                }
            });
        });
        return deferred.promise;
    }

    function _openLiveBrowserLinux(url, callback) {
        var user_data_dir = getApplicationSupportDirectory() + '/editor' + '/live-dev-profile';
        var args = [url, '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--temp-profile', '--user-data-dir=' + user_data_dir];
        var res = cpExec("which google-chrome", function (error, path, stderr) {
            if (error === null && path) {
                var cp = spawn(path.trim(), args);
                liveBrowserOpenedPIDs.push(cp.pid);
                callback(null, cp.pid);
            } else {
                //TODO: Review error handling
                callback(FILE_NOT_FOUND);
            }
        });
    }

    function _openLiveBrowserMac(url, callback) {
        _findAppByKeyMac("com.google.Chrome")
            .then(function (path) {
                var user_data_dir = getApplicationSupportDirectory() + '/editor' + '/live-dev-profile';
                var args = [url, '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--temp-profile', '--user-data-dir=' + user_data_dir];
                //:TODO: The following wont' work if we don't set the remote-debugging-port
                var res = cpExec("kill $(ps -Aco pid,args | awk '/remote-debugging-port=9222/{print$1}')", function (error, stdout, stderr) {
                    if (path) {
                        var cp = spawn(path, args);
                        liveBrowserOpenedPIDs.push(cp.pid);
                        callback(null, cp.pid);
                    } else {
                        //TODO: Review error handling
                        callback(FILE_NOT_FOUND);
                    }
                });
            })
            .fail(function (err) {
                //TODO: Review error handling
                callback(FILE_NOT_FOUND);
            })
            .done();
    }

    function _openLiveBrowserWindows(url, callback) {
        var Winreg = require('winreg');
        var regKey1 = new Winreg({
            hive: Winreg.HKLM,                                          // HKEY_LOCAL_MACHINE
            key:  '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe' // 
        });

        var regKey2 = new Winreg({
            hive: Winreg.HKCU,                                          // HKEY_CURRENT_USER
            key:  '\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders' // 
        });

        var user_data_dir = getApplicationSupportDirectory() + '/editor' + '/live-dev-profile';
        var args = [url, '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--temp-profile', '--user-data-dir=' + user_data_dir];
        
        //TODO: Review error handling 
        regKey1.values(function (err, items) {
            if (!err && items && items.length) {
                regKey1.get(items[0].name, function (err, item) {
                    if (!err && item) {
                        var path = item.value + '\\chrome.exe';
                        var cp = spawn(path, args).on('error', console.error); // avoiding Node crash in case of exception
                        if (cp.pid !== 0) {
                            liveBrowserOpenedPIDs.push(cp.pid);
                            callback(null, cp.pid);
                        } else {
                            callback(CANNOT_RUN_BROWSER);
                        }
                    } else {
                        callback(FILE_NOT_FOUND);
                    }
                });
            } else {
                regKey2.values(function (err, items) {
                    if (!err && items) {
                        regKey2.get('Local AppData', function (err, item) {
                            if (!err && item) {
                                var path = item.value + '\\Google\\Chrome\\Application\\chrome.exe';
                                var cp = spawn(path, args).on('error', console.error); // avoiding Node crash in case of exception
                                if (cp.pid !== 0) {
                                    liveBrowserOpenedPIDs.push(cp.pid);
                                    callback(null, cp.pid);
                                } else {
                                    callback(CANNOT_RUN_BROWSER);
                                }
                            }
                        });
                    } else {
                        callback(FILE_NOT_FOUND);
                    }
                });
            }
        });
    }

    /**
     * Open the live browser
     *
     * @param {string} url
     * @param {function(err)=} callback Asynchronous callback function with one argument (the error)
     *        Possible error values:
     *          NO_ERROR
     *          ERR_INVALID_PARAMS - invalid parameters
     *          ERR_UNKNOWN - unable to launch the browser
     *          ERR_NOT_FOUND - unable to find a browers to launch
     *
     * @return None. This is an asynchronous call that sends all return information to the callback.
     */
    function openLiveBrowser(url, callback) {
        var openLiveBrowserPlatform = null;

        if (process.platform === "win32") {
            openLiveBrowserPlatform = _openLiveBrowserWindows;
        } else if (process.platform === "darwin") {
            openLiveBrowserPlatform = _openLiveBrowserMac;
        } else if (process.platform === "linux") {
            openLiveBrowserPlatform = _openLiveBrowserLinux;
        }
        if (openLiveBrowserPlatform) {
            openLiveBrowserPlatform(url, callback);
        }
    }

    /**
     * Attempts to close the live browser. The browser can still give the user a chance to override
     * the close attempt if there is a page with unsaved changes. This function will fire the
     * callback when the browser is closed (No_ERROR) or after a three minute timeout (ERR_UNKNOWN). 
     *
     * @param {function(err)} callback Asynchronous callback function with one argument (the error) 
     *        Possible error values:
     *          NO_ERROR (all windows are closed by the time the callback is fired)
     *          ERR_UNKNOWN - windows are currently open, though the user may be getting prompted by the 
     *                      browser to close them
     *
     * @return None. This is an asynchronous call that sends all return information to the callback.
     */
    function closeLiveBrowser(pid, callback) {
        if (isNaN(pid)) {
            pid = 0;
        }
        if (pid) {
            var i = liveBrowserOpenedPIDs.indexOf(pid);
            if (i !== -1) {
                liveBrowserOpenedPIDs.splice(i, 1);
            }
            if (process.platform === "win32") {
                var args = ["/PID"];
                args.push(pid);
                spawn("taskkill", args);
            } else {
                process.kill(pid);
            }
        }
        //:TODO: callback needed?
    }
    
    /** closeAllLiveBrowsers
     * Closes all the browsers that were tracked on open
     * TODO: does not seem to work on Windows
     * @return {$.Promise}
     */
    function closeAllLiveBrowsers() {
        var length = liveBrowserOpenedPIDs.length;
        while (liveBrowserOpenedPIDs.length) {
            closeLiveBrowser(liveBrowserOpenedPIDs[0]);
        }
    }

    exports.NO_ERROR                    = NO_ERROR;
    exports.openLiveBrowser             = openLiveBrowser;
    exports.closeLiveBrowser            = closeLiveBrowser;
    exports.closeAllLiveBrowsers        = closeAllLiveBrowsers;

}());
