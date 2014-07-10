/*
 * Copyright (c) 2014 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, forin: true, maxerr: 50, regexp: true */
/*global define, $, brackets, window, open */

// This transport provides a WebSocket connection between Brackets and a live browser preview.
// This is just a thin wrapper around the Node extension (NodeSocketTransportDomain) that actually
// provides the WebSocket server and handles the communication. We also rely on an injected script in
// the browser for the other end of the transport.

define(function (require, exports, module) {
    "use strict";
    
    var ExtensionUtils = brackets.getModule("utils/ExtensionUtils"),
        NodeDomain = brackets.getModule("utils/NodeDomain");
    
    // The script that will be injected into the previewed HTML to handle the other side of the socket connection.
    var NodeSocketTransportRemote = require("text!transports/remote/NodeSocketTransportRemote.js");

    // The node extension that actually provides the WebSocket server.
    var NodeSocketTransportDomain = new NodeDomain("nodeSocketTransport", ExtensionUtils.getModulePath(module, "node/NodeSocketTransportDomain"));
    
    // This must match the port declared in NodeSocketTransportDomain.js.
    // TODO: randomize this?
    var SOCKET_PORT = 8123;
    
    /**
     * Returns the script that should be injected into the browser to handle the other end of the transport.
     * @return {string}
     */
    function getRemoteScript() {
        return "<script>\n" +
            NodeSocketTransportRemote +
            "this._Brackets_LiveDev_Socket_Transport_URL = 'ws://localhost:" + SOCKET_PORT + "';\n" +
            "</script>\n";
    }

    // Events
    
    // We can simply retrigger the events we receive from the node domain directly, since they're in
    // the same format expected by clients of the transport.
    ["connect", "message", "close"].forEach(function (type) {
        $(NodeSocketTransportDomain).on(type, function () {
            console.log("NodeSocketTransport - event - " + type + " - " + JSON.stringify(Array.prototype.slice.call(arguments, 1)));
            // Remove the event object from the argument list.
            $(exports).triggerHandler(type, Array.prototype.slice.call(arguments, 1));
        });
    });
    
    // Exports
    
    exports.getRemoteScript = getRemoteScript;
    
    // Proxy the node domain methods directly through, since they have exactly the same
    // signatures as the ones we're supposed to provide.
    ["send", "close", "closeAllBrowsers"].forEach(function (method) {
        exports[method] = function () {
            var args = Array.prototype.slice.call(arguments);
            args.unshift(method);
            console.log("NodeSocketTransport - " + args);
            NodeSocketTransportDomain.exec.apply(NodeSocketTransportDomain, args);
        };
    });
    
    exports.launch = function (url, browser, checkOnly) {
        console.log("NodeSocketTransport - launching " + url + " in " + browser);
        NodeSocketTransportDomain.exec("launch", url, browser, checkOnly).done(function (pid) {
            console.log("pid = " + pid);
            if (checkOnly) {  // We can always trigger the event and ignore this flag if we want to
                $(exports).triggerHandler("browser.installed", [browser, true]);
            }
        }).fail(function (err) {
            console.log("[NodeSocketTransport] failed to launch", err);
            $(exports).triggerHandler("browser.installed", [browser, false]);
        });
    };

});
