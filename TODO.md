# TODO

### Flow

1. ~~something to check the rss page and flags changes~~
2. ~~something that downloads the new rss page content~~
3. ~~something that flags matches in the new rss page content against the items list~~
4. ~~presumably something that fetches the items list (keeping it up to date)~~
5. ~~some module that calls openai api~~
6. ~~some higher level module that uses the openai api module, the new rss page content, and the matched items list and makes a series of calls (one per item) to get semantic analysis of the expected price changes, along with the text snippet that supports this (structured output)~~
7. ~~some module that is capable of sending telegram messages through a bot~~
8. some higher level module that puts together the content of the openai response, semantic analysis, text snippets, etc, and sends it as a message using the telegram bot module (this is seemingly the highest level module and should be index.js)