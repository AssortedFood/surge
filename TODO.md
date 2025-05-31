# TODO

### 4. something that flags matches in the new rss page content against the items list

- new module that takes two args (post.txt, item_list.json) and does an efficient O of n look up of all the words in post.txt against all the names in item_list.json (e.g. "name": "3rd age amulet")
- it .lower() all the words in the post.txt as well as the names from the item_list
- it returns a list of the matches, if any
- it can be called with node to print this list to the console

### Flow

1. ~~something to check the rss page~~
2. something that flags a change
3. ~~something that downloads the new rss page content~~
4. something that flags matches in the new rss page content against the items list
5. ~~presumably something that fetches the items list (keeping it up to date)~~
6. some module that calls openai api
7. some higher level module that uses the openai api module, the new rss page content, and the matched items list and makes a series of calls (one per item) to get semantic analysis of the expected price changes, along with the text snippet that supports this (structured output)
8. some module that is capable of sending telegram messages through a bot
9. some higher level module that puts together the content of the openai response, semantic analysis, text snippets, etc, and sends it as a message using the telegram bot module (this is seemingly the highest level module and should be index.js)