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

        MAC_MDFIND_QUERY    = "mdfind \"kMDItemCFBundleIdentifier == '%s'\"",
        MAC_CODESIGN_QUERY  = "codesign --display \"%s\"";

    /**
     * @private
     * An array of opened browser pids.
     */
    var liveBrowserOpenedPIDs = [];

    // The following function is temp for testing, //:TODO: Set and get the appropriate folder
    function getApplicationSupportDirectory() {
        if (process.platform === "win32") {
            return 'c:\\TEMP';
        } else if (process.platform === "darwin") {
            return process.env.HOME + "/TEMP";
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
                    path = pathToBinary.replace("Executable=", "");

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

    function _openLiveBrowserLinux(url, browser, checkOnly, callback) {
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

    function _openLiveBrowserMac(url, browser, checkOnly, callback) {
        
        var fs = require("fs"),
            args = [],
            appKey = "",
            user_data_dir = getApplicationSupportDirectory() + "/editor" + "/live-dev-profile";

        function openBrowser(path, args) {
            if (path) {
                var cp = spawn(path, args);
                liveBrowserOpenedPIDs.push(cp.pid);
                callback(null, cp.pid);
            } else {
                //TODO: Review error handling
                callback(FILE_NOT_FOUND);
            }
        }
        
        switch (browser) {
        case "Chrome":
            args = [url, "--no-first-run", "--no-default-browser-check", "--allow-file-access-from-files", "--temp-profile", "--user-data-dir=" + user_data_dir];
            appKey = "com.google.Chrome";
            break;
        case "Firefox":
            args = ["-silent", "-no-remote", "-new-window", "-P", "live-dev-profile", "-url", url];
            appKey = "org.mozilla.firefox";
            break;
        }

        _findAppByKeyMac(appKey)
            .then(function (path) {
                if (checkOnly) {  // only checking if installed, don't want to open
                    callback(null, 0);
                } else if (browser === "Chrome") {
                    //Note: The following wont' work if we don't set the remote-debugging-port
                    var res = cpExec("kill $(ps -Aco pid,args | awk '/remote-debugging-port=9222/{print$1}')", function (error, stdout, stderr) {
                        openBrowser(path, args);
                    });
                } else if (browser === "Firefox") {
                    if (!fs.existsSync(user_data_dir + "/prefs.js")) {
                        // if it's the first time running create a profile
                        var args2 = ["-createProfile", "live-dev-profile " + user_data_dir];
                        spawn(path, args2);
                        setTimeout(function () {openBrowser(path, args); }, 500); // open the browser after a delay to give time to above run first
                    } else {
                        openBrowser(path, args);
                    }
                }
            })
            .fail(function (err) {
                //TODO: Review error handling
                callback(FILE_NOT_FOUND);
            })
            .done();
    }

    function _openLiveBrowserWindows(url, browser, checkOnly, callback) {
        var Winreg = require('winreg');
        var user_data_dir = getApplicationSupportDirectory() + '\\editor' + '\\live-dev-profile';

        var regKeyPath1,
            regKeyPath2 = '\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
            excutablePath2,
            args,
            fs = require("fs");

        switch (browser) {
        case "Chrome":
            regKeyPath1 = '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe';
            excutablePath2 = '\\Google\\Chrome\\Application\\chrome.exe';
            args = [url, '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--temp-profile', '--user-data-dir=' + user_data_dir];
            break;
        case "Firefox":
            regKeyPath1 = "\\SOFTWARE\\Clients\\StartMenuInternet\\FIREFOX.EXE\\shell\\open\\command";
            excutablePath2 = "\\Mozilla\\Firefox\\Application\\firefox.exe";  //TODO: check if this is correct
            args = ["-silent", "-no-remote", "-new-window", "-P", "live-dev-profile", "-url", url];
            break;
        default:
            callback(FILE_NOT_FOUND);
            return;
        }

        var regKey1 = new Winreg({
            hive: Winreg.HKLM,                                          // HKEY_LOCAL_MACHINE
            key:  regKeyPath1
        });

        var regKey2 = new Winreg({
            hive: Winreg.HKCU,                                          // HKEY_CURRENT_USER
            key:  regKeyPath2
        });

        function findAndOpenBrowser() {
            //TODO: Review error handling
            function openBrowser(path) {
                if (!checkOnly) {
                    var cp = spawn(path, args).on('error', console.error); // avoiding Node crash in case of exception
                    if (cp.pid !== 0) {
                        liveBrowserOpenedPIDs.push(cp.pid);
                        callback(null, cp.pid);
                    } else {
                        callback(FILE_NOT_FOUND);
                    }
                } else {                // if we don't want to actually launch
                    if (fs.existsSync(path)) {
                        callback(null, 0);  // indicates browser installed
                    } else {
                        callback(FILE_NOT_FOUND);
                    }
                }
            }
            
            regKey1.values(function (err, items) {
                if (!err && items && items.length) {
                    var path = items[0].value.replace(/"/g, '');
                    openBrowser(path);
                } else {
                    regKey2.values(function (err, items) {
                        if (!err && items) {
                            regKey2.get('Local AppData', function (err, item) {
                                if (!err && item) {
                                    var path = item.value + excutablePath2;
                                    openBrowser(path);
                                }
                            });
                        } else {
                            callback(FILE_NOT_FOUND);
                        }
                    });
                }
            });
        }

        if (browser === "Firefox" && !fs.existsSync(user_data_dir + "/prefs.js") && !checkOnly) {
            // if it's the first time running create a profile
            var args2 = ["-createProfile", "live-dev-profile " + user_data_dir];
            regKey1.values(function (err, items) {
                if (!err && items && items.length) {
                    var path = items[0].value.replace(/"/g, '');
                    spawn(path, args2).on('error', console.error);
                    // Note: To prevent FF asking to be default can add the following line to the prefs.js file: 
                    //       user_pref("browser.shell.checkDefaultBrowser", false);
                    setTimeout(findAndOpenBrowser, 500); // open the browser after a delay to give time to above run first
                }
            });
        } else {
            findAndOpenBrowser();
        }

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
    function openLiveBrowser(url, browser, checkOnly, callback) {
        var openLiveBrowserPlatform = null;
      
        if (process.platform === "win32") {
            openLiveBrowserPlatform = _openLiveBrowserWindows;
        } else if (process.platform === "darwin") {
            openLiveBrowserPlatform = _openLiveBrowserMac;
        } else if (process.platform === "linux") {
            openLiveBrowserPlatform = _openLiveBrowserLinux;
        }
        if (openLiveBrowserPlatform) {
            openLiveBrowserPlatform(url, browser, checkOnly, callback);
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
