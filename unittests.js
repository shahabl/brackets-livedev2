/*
 * Copyright (c) 2013 Adobe Systems Incorporated. All rights reserved.
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

/*global $, brackets, define, describe, it, xit, expect, beforeFirst, afterLast, console, beforeEach, afterEach, waitsFor, waitsForDone, runs, window, spyOn, jasmine */

define(function (require, exports, module) {
    "use strict";
    
    var SpecRunnerUtils = brackets.getModule("spec/SpecRunnerUtils"),
        FileUtils               = brackets.getModule("file/FileUtils"),
        Async                   = brackets.getModule("utils/Async"),
        PreferencesDialogs      = brackets.getModule("preferences/PreferencesDialogs"),
        Strings                 = brackets.getModule("strings"),
        StringUtils             = brackets.getModule("utils/StringUtils"),
        FileSystem              = brackets.getModule("filesystem/FileSystem"),
        Inspector;
    
    // The following are all loaded from the test window
    var CommandManager,
        Commands,
        Dialogs,
        NativeApp,
        DocumentManager,
        ProjectManager;
    
    var LiveDevelopment,
        LiveDevProtocol,
        LiveHTMLDocument;
    
    var extensionPath = FileUtils.getNativeModuleDirectoryPath(module),
        testPath      = extensionPath + "/unittest-files/",
        tempDir       = SpecRunnerUtils.getTempDirectory(),
        testWindow;
    
    
    function openLiveDevelopmentAndWait() {
        // start live dev
        runs(function () {
            waitsForDone(LiveDevelopment.open(), "LiveDevelopment.open()", 15000);
        });
    }
    
    function saveAndWaitForLoadEvent(doc) {
        var deferred = new $.Deferred();
            
        // documentSaved is fired async after the FILE_SAVE command completes.
        // Instead of waiting for the FILE_SAVE promise, we listen to the
        // inspector connection to confirm that the page reload occurred
        testWindow.$(LiveDevProtocol).on("loadEventFired", deferred.resolve);
        
        // remove event listener after timeout fires
        deferred.always(function () {
            testWindow.$(LiveDevProtocol).off("loadEventFired", deferred.resolve);
        });
        
        // save the file
        var fileSavePromise = CommandManager.execute(Commands.FILE_SAVE, {doc: doc});
        waitsForDone(fileSavePromise, "FILE_SAVE", 1000);
        
        // wrap with a timeout to indicate loadEventFired was not fired
        return Async.withTimeout(deferred.promise(), 2000);
    }
    
    
    describe("LiveDevelopment2", function () {
        var extensionPath = FileUtils.getNativeModuleDirectoryPath(module),
            testPath      = extensionPath + "/unittest-files/";
            
        this.category = "integration";

        beforeFirst(function () {
            LiveDevelopment = require("LiveDevelopment");
            LiveDevProtocol = require("protocol/LiveDevProtocol");
            LiveHTMLDocument = require("documents/LiveHTMLDocument");
            
            SpecRunnerUtils.createTempDirectory();

            SpecRunnerUtils.createTestWindowAndRun(this, function (w) {
                testWindow           = w;
                Dialogs              = testWindow.brackets.test.Dialogs;
                DocumentManager      = testWindow.brackets.test.DocumentManager;
                CommandManager       = testWindow.brackets.test.CommandManager;
                Commands             = testWindow.brackets.test.Commands;
                NativeApp            = testWindow.brackets.test.NativeApp;
                ProjectManager       = testWindow.brackets.test.ProjectManager;
            });
        });

        afterLast(function () {
            runs(function () {
                testWindow           = null;
                Dialogs              = null;
                LiveDevelopment      = null;
                DocumentManager      = null;
                CommandManager       = null;
                Commands             = null;
                NativeApp            = null;
                ProjectManager       = null;
                SpecRunnerUtils.closeTestWindow();
            });

            SpecRunnerUtils.removeTempDirectory();
        });
        
        beforeEach(function () {
            // verify live dev isn't currently active
            expect(LiveDevelopment.status).toBe(LiveDevelopment.STATUS_INACTIVE);
        
            // copy files to temp directory
            runs(function () {
                waitsForDone(SpecRunnerUtils.copyPath(testPath, tempDir), "copy temp files");
            });
            
            // open project
            runs(function () {
                SpecRunnerUtils.loadProjectInTestWindow(tempDir);
            });
        });
        
        afterEach(function () {
            runs(function () {
                waitsForDone(LiveDevelopment.close(), "Waiting for browser to become inactive", 10000);
            });
            
            testWindow.closeAllFiles();
        });
        
        describe("JS Editing", function () {
            
            it("should reload the page when editing a non-live document", function () {
                var promise,
                    jsdoc,
                    loadEventPromise;
                
                runs(function () {
                    // Setup reload spy
                    spyOn(LiveHTMLDocument, "reload").andCallThrough();
                    
                    promise = SpecRunnerUtils.openProjectFiles(["simple1.html"]);
                    waitsForDone(promise, "SpecRunnerUtils.openProjectFiles simple1.html", 1000);
                });

                openLiveDevelopmentAndWait();
                
                runs(function () {
                    promise = SpecRunnerUtils.openProjectFiles(["simple1.js"]);
                    promise.done(function (openDocs) {
                        jsdoc = openDocs["simple1.js"];
                    });
                    
                    waitsForDone(promise, "SpecRunnerUtils.openProjectFiles simple1.js", 1000);
                });

                runs(function () {
                    // Edit a JavaScript doc
                    jsdoc.setText("window.onload = function () {document.getElementById('testId').style.backgroundColor = '#090'}");
                    
                    // Make sure the live development dirty dot shows
                    expect(LiveDevelopment.status).toBe(LiveDevelopment.STATUS_OUT_OF_SYNC);

                    // Save changes to the test file
                    loadEventPromise = saveAndWaitForLoadEvent(jsdoc);
                });
                
                runs(function () {
                    // Browser should reload when saving non-live files like JavaScript
                    waitsForDone(loadEventPromise, "loadEventFired", 3000);
                });
                
                runs(function () {
                    
                    expect(LiveHTMLDocument.reload.callCount).toEqual(1);
                    
                    // Edit the file again
                    jsdoc.setText("window.onload = function () {document.body.style.backgroundColor = '#090'}");
                    
                    // Save changes to the test file...again
                    loadEventPromise = saveAndWaitForLoadEvent(jsdoc);
                });
                
                runs(function () {
                    // Browser should reload again
                    waitsForDone(loadEventPromise, "loadEventFired", 3000);
                });
                
                runs(function () {
                    expect(LiveHTMLDocument.reload.callCount).toEqual(2);
                });
            });

        });
    });

    describe("Remote functions", function () {
        
        describe("RelatedDocuments", function () {

            var htmlDocument,
                head,
                mockTransport;
                    
            var DocumentObserver = require("text!protocol/remote/DocumentObserver.js");
            DocumentObserver = eval("(" + DocumentObserver.trim() + ")()");
            
            beforeEach(function () {
                htmlDocument = window.document.implementation.createHTMLDocument();
                head = htmlDocument.getElementsByTagName('head')[0];
                mockTransport = jasmine.createSpyObj('mockTransoprt', ['send']);
                mockTransport.send.andCallFake(function (msg) { console.log(msg); });
            });
            
            afterEach(function () {
                htmlDocument = null;
                mockTransport = null;
            });
                 
            it('should return all the external JS files', function () {
                
                var s1Url = "http://some_url.com/s1.js";
                var s1 = htmlDocument.createElement('script');
                s1.type = "text/javascript";
                s1.src = s1Url;
                head.appendChild(s1);
                
                var s2Url = "http://some_url.com/s2.js";
                var s2 = htmlDocument.createElement('script');
                s2.type = "text/javascript";
                s2.src = s2Url;
                head.appendChild(s2);
                
                DocumentObserver.start(htmlDocument, mockTransport);
                var related = DocumentObserver.related();
                
                expect(related.scripts[s1Url]).toBe(true);
                expect(related.scripts[s2Url]).toBe(true);
                
            });
                
        });
    });
});
