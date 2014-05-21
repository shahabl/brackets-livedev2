This is an experimental repo for prototyping how we might replace the current live development architecture in Brackets with something more flexible that isn't tied solely to Chrome Developer Tools. It's based on the current Live Development code in Brackets, and can be installed (hackily) as an extension.

### What's working

If you install the extension, you'll get a second lightning bolt on the toolbar (below the Extension Manager icon). You can open an HTML page (I've only tried the Getting Started page) and then click that second lightning bolt to enter HTML live development using the extension. This will launch the page in your browser. You should then also be able to copy and paste the URL from that browser into any other browser (I tried Firefox and Safari) - live edits will then update all connected browsers at once.

### What's not working

Lots:

* There's a preliminary implementation (Chrome on Mac and Windows only) so closing live dev close the browser window. It needs to be completed and tested on Linux.
* Lightning bolt doesn't turn off when browser preview is closed. Haven't thought through how we should indicate in the UI when multiple browser clients are active, and whether we should turn the lightning bolt off when the last one disconnects - this might also change if we change the workflow to allow multiple files to be previewed
* I wanted to change up how the Server stuff worked, but it turned out not to be necessary for the prototype and it might just be orthogonal.
* No unit tests (the original Live Dev tests would need to be completely rewritten - and ideally in a more granular fashion with mocks)

Bugs/cleanup/TODO:

* Doesn't show an error if the browser never connects back
* Live highlight sometimes turns off temporarily; doesn't show highlight immediately when new browser connects
* spurious errors when socket is closed
* hard-coded port number for WebSocket server (might be fine)
* Lots of TODOs in the code

### Basic architecture

The primary difference in this architecture is that communication with the browser is done via an injected script rather than CDT's native remote debugging interface, and the browser connects back to Brackets rather than Brackets connecting to the browser. This makes it so:

* launching a preview, injecting scripts into the HTML, and establishing the connection between the previewed page and Brackets are relatively simple and largely decoupled
* live preview can work in any browser, not just Chrome
* multiple browsers can connect to the same live preview session in Brackets
* browsers could theoretically connect from anywhere on the network that can see Brackets (though right now it's only implemented for localhost)
* opening dev tools in the browser doesn't break live preview

Communication between Brackets and the browser is factored into three layers:

1. a low-level "transport" layer, which is responsible for launching live preview in the browser and providing a simple textual message bus between the browser and Brackets.
2. the "protocol" layer, which sits on top of the transport layer and provides the actual semantic behavior (currently just "evaluate in browser")
3. the injected RemoteFunctions script, which is the same as in today's LiveDevelopment and provides Brackets-specific functionality (highlighting, DOM edit application) on top of the core protocol.

The reason for this factoring is so that the transport layer can be swapped out for different use cases, and so that anything higher-level we need that can be easily built in terms of eval doesn't have to be built into the protocol.

(We could arguably get rid of the distinction between (2) and (3), and basically roll all the Brackets functionality into the "protocol" layer by simply merging the RemoteFunctions script into the protocol remote script. The only reason to keep the protocol layer separate, IMO, is if we want to keep it compatible with CDT, a la RemoteDebug - so it only provides the functionality that CDT does.)

The transport layer currently implemented uses a WebSocket server in Node, coupled with an injected script in the browser that connects back to that server. However, this could easily be swapped out for a different transport layer that supports a preview iframe directly inside Brackets, where the communication is via `postMessage()`.

The protocol layer currently exposes a very simple API that just contains specific protocol functions (currently just "evaluate", which evals in the browser). I chose not to reimplement the CDT facade that LiveDevelopment was previously using (the Inspector class), but we could decide to do that if we wanted. The over-the-wire protocol is a JSON message that more or less looks like the CDT wire protocol, although it's not an exact match right now - again, we could decide to make it exactly mimic CDT if we wanted.

If we want to eventually reintroduce a CDT connection (or hook up to RemoteDebug), we have two choices: we could either just implement it as a separate transport, or we could implement it as a separate protocol impl entirely. Implementing it as a transport would be easier, and would be fine for talking to our own injected script; but it would only make sense for talking to CDT-specific functionality if we were very good about our wire protocol looking like the CDT wire protocol in general. Otherwise, we would probably want to consider swapping out the protocol entirely.

### Explanation of the flow

I've created a [really crappy block diagram](https://raw.githubusercontent.com/wiki/njx/brackets-livedev2/livedev2-block-diagram.png) of how the various bits talk to each other.

Here's a short summary of what happens when the user clicks on the Live Preview button on an HTML page.

1. LiveDevelopment creates a LiveHTMLDocument for the page, passing it the protocol handler (LiveDevProtocol). LiveHTMLDocument manages communication between the editor and the browser for HTML pages.
2. LiveDevelopment tells StaticServer that this path has a live document. StaticServer is in charge of actually serving the page and associated assets to the browser. (Note: eventually I think we should get rid of this step - StaticServer shouldn't know anything about live documents directly; it should just have a way of request instrumented text for HTML URLs.)
3. LiveDevelopment tells the protocol to open the page via the StaticServer URL. The protocol just passes this through to the transport (NodeSocketTransport), which first creates a WebSocket server if it hasn't already, then opens the page in a browser.
4. The browser requests the page from StaticServer. StaticServer notes that there is a live document for this page, and requests an instrumented version of the page from LiveHTMLDocument. (The current "requestFilterPaths" mechanism for this could be simplified, I think.)
5. LiveHTMLDocument instruments the page for live editing using the existing HTMLInstrumentation mechanism, and additionally includes remote scripts provided by the protocol (LiveDevProtocolRemote) and transport (NodeSocketTransportRemote). (The transport script includes the URL for the WebSocket server created in step 3.)
6. The instrumented page is sent back to StaticServer, which responds to the browser with the instrumented version. Other files requested by the browser are simply returned directly by StaticServer.
7. As the browser loads the page, it encounters the injected transport and protocol scripts. The transport script connects back to the NodeSocketTransport's WebSocket server created in step 3 and sends it a "connect" message to tell it what URL has been loaded in the browser. The NodeSocketTransport assigns the socket a client id so it can keep track of which socket is associated with which page instance, then raises a "connect" event.
8. The LiveHTMLDocument receives the "connect" event and makes a note of the associated client ID. It injects its own script (RemoteFunctions) that handles higher-level functionality like highlighting and applying DOM edits.
9. As the user makes live edits or changes selection, LiveHTMLDocument calls the protocol handler's "evaluate" function to call functions from the injected RemoteFunctions.
10. The protocol's "evaluate" method packages up the request as a JSON message and sends it via the transport.
11. The remote transport handler unpacks the message and passes it to the remote protocol handler, which finally interprets it and evals its content.
12. If another browser loads the same page (from the StaticServer URL), steps 4-8 repeat, with LiveHTMLDocument just adding the new connection's client ID to its list. Future evals are then sent to all the associated client IDs for the page.

### What's next

The main next steps are:

#### Unit tests

We would definitely need a good suite of unit tests for the new functionality. I suspect it would be easier to just write entirely new, more granular unit tests than to try to reuse the old LiveDevelopment integration tests (which were fragile anyway).

#### Figure out how to launch multiple browsers from the UI

TBD. My initial thinking for Brackets is that we would turn the lightning bolt into a dropdown button, where clicking on the dropdown arrow would give you a choice of browsers. We would also need some way to configure the browser executable paths, or autodetect them for common cases.

#### 

There's a need to track other related non-CSS documents (e.g. JS files) that are loaded by the current live HTML file; we do this because for those files, we want to reload the full page whenever the user saves those files. (See comments in LiveDevelopment._onDocumentSaved().) In the old Live Development, we did this by looking at a different CDT event that was sent out whenever the page was about to request a file. Again, I think we could just replace that with the same mechanism described above (having the server tell us what files were requested).

We should consider changing the workflow to allow multiple files to be previewed (rather than only having a single preview that changes as you switch files in Brackets).
In the future, if we allow multiple files to be previewed simultaneously, we would need to match requested files to the pages that loaded them. I think we could still do that on the Brackets server side by looking at the referrer.

### Changes from existing LiveDevelopment code

* the existing code for talking to Chrome Developer Tools via the remote debugging interface is gone for now
* CSSDocument and HTMLDocument were renamed to LiveCSSDocument and LiveHTMLDocument, with a new LiveDocument base class
* the "agents" are all gone - a lot of them were dead code anyway; other functionality was rolled into LiveDocument
* communication is factored into transport and protocol layers (see above)
* HTMLInstrumentation and HTMLSimpleDOM were modified slightly (which is why they're copied into the extension), to make it possible to inject the remote scripts and to fix an issue with re-instrumenting the HTML when a second browser connects to Live Development. The former change is harmless; the latter change would need some review or possibly more work in order to merge into master. 
* CSS live editing is enabled differently.  When a CSS file is selected in the editor, its url is sent down to the main live document and compared with all style sheets loaded with a link element, and reloads the CSS file if it's there. 
* When switching files in the editor, a command is sent to the injected code in browser to load the new file after a set delay (currently 500 mS).
* ignore the changes to main.js and the copied styles for now - those were just to make this work as an extension and avoid conflicting with the existing LiveDocument functionality
