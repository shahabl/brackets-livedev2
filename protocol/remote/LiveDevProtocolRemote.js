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

/*jslint evil: true */

// This is the script that Brackets live development injects into HTML pages in order to
// establish and maintain the live development socket connection. Note that Brackets may
// also inject other scripts via "evaluate" once this has connected back to Brackets.

(function (global) {
    "use strict";
    
    // This protocol handler assumes that there is also an injected transport script that
    // has the following methods:
    //     setCallbacks(obj) - a method that takes an object with a "message" callback that
    //         will be called with the message string whenever a message is received by the transport.
    //     send(msgStr) - sends the given message string over the transport.
    var transport = global._Brackets_LiveDev_Transport;
    
    /**
     * Manage messaging between Editor and Browser at the protocol layer.
     * Handle messages that arrives through the current transport and dispatch them 
     * to subscribers. Subscribers are handlers that implements remote commands/functions.
     * Property 'method' of messages body is used as the 'key' to identify message types.   
     * Provide a 'send' operation that allows remote commands sending messages to the Editor.
     */
    var MessageBroker = {
                
        /**
         * Collection of handlers (subscribers) per each method.
         * To be pushed by 'on' and consumed by 'trigger' stored this way: 
         *      handlers[method] = [handler1, handeler2, ...]
         */
        handlers: {},
        
         /**
          * Dispatch messages to handlers according to msg.method value.
          * @param {Object} Message to be dispatched.
          */
        trigger: function (msg) {
            var handlers;
            if (!msg.method) {
                // no message type, ignoring it
                // TODO: should we trigger a generic event?
                console.log("[Brackets LiveDev] Received message without method.");
                return;
            }
            // get handlers for msg.method
            handlers = this.handlers[msg.method];
            
            if (handlers && handlers.length > 0) {
                //invoke handlers with the received message
                this.handlers[msg.method].forEach(function (handler) {
                    try {
                        //TODO: check which context should be used to call handlers here.
                        handler(msg);
                        return;
                    } catch (e) {
                        console.error("[Brackets LiveDev] Error executing a handler for " + msg.method);
                        return;
                    }
                });
            } else {
                // no subscribers, ignore it.
                // TODO: any other default handling? (eg. specific respond, trigger as a generic event, etc.);
                console.log("[Brackets LiveDev] No subscribers for message " + msg.method);
                return;
            }
        },
        
        /**
         * Send a response of a particular message to the Editor.
         * Original message must provide an 'id' property
         * @param {Object} Original message
         * @param {string} Message to be sent as the response.
         */
        respond: function (orig, response) {
            if (!orig.id) {
                console.log("[Brackets LiveDev] Trying to send a response for a message with no ID");
                return;
            }
            response.id = orig.id;
            transport.send(JSON.stringify(response));
        },
        
        /**
         * Subscribe handlers to specific messages.
         * @param {string} method Message type.
         * @param {function} handler.
         * TODO: add handler name or any identification mechanism to then implement 'off'?
         */
        on: function (method, handler) {
            if (!method || !handler) {
                return;
            }
            if (!this.handlers[method]) {
                //initialize array
                this.handlers[method] = [];
            }
            // add handler to the stack
            this.handlers[method].push(handler);
        },
        
        /**
         * Send a message to the Editor.
         * @param {string} msgStr Message to be sent.
         */
        send: function (msgStr) {
            transport.send(JSON.stringify(msgStr));
        }
    };
    
        
    /*
    * Runtime Domain. Implements remote commands for "Runtime.*"
    */
    var Runtime = {
        /**
         * Evaluate an expresion and return its result.
         */
        evaluate: function (msg) {
            console.log("Runtime.evaluate");
            var result = eval(msg.params.expression);
            MessageBroker.respond(msg, {
                result: JSON.stringify(result) // TODO: in original protocol this is an object handle
            });
        }
    };
    
    // subscribe handler to method Runtime.evaluate
    MessageBroker.on("Runtime.evaluate", Runtime.evaluate);
    
    /**
     * Page Domain.
     */
    var Page = {
        /**
         * Reload the current page optionally ignoring cache.
         * @param {Object} msg
         */
        reload: function (msg) {
            // just reload the page
            window.location.reload(msg.params.ignoreCache);
        }
    };
         
    // subscribe handler to method Page.reload
    MessageBroker.on("Page.reload", Page.reload);
        
    /**
     * The remote handler for the protocol.
     */
    var ProtocolHandler = {
        /**
         * Handles a message from the transport. Parses it as JSON and delegates
         * to MessageBroker who is in charge of routing them to handlers.
         * @param {msgStr} string The protocol message as stringified JSON.
         */
        message: function (msgStr) {
            var msg;
            try {
                msg = JSON.parse(msgStr);
            } catch (e) {
                console.log("[Brackets LiveDev] Invalid Message Received");
            }
            // delegates handling/routing to MessageBroker.
            MessageBroker.trigger(msg);
        }
    };
    
    // By the time this executes, there must already be an active transport.
    if (!transport) {
        console.error("[Brackets LiveDev] No transport set");
        return;
    }
    
    transport.setCallbacks(ProtocolHandler);

}(this));
