# TODO

### 6. some higher level module that uses the openai api module, the new rss page content, and an item name (found inside the post.txt) and makes a call to get semantic analysis of the expected price change of that item, along with the text snippet that supports this (structured output)

- given the params (post.txt, item_name)
- uses fetchStructuredResponse and some zod object (attached below)

    ```
    // schemas/ItemAnalysisSchema.js

    import { z } from 'zod';

    const ItemAnalysisSchema = z.object({
    relevant_text_snippet: z.string()
    expected_price_change: z.enum([
        "Price increase",
        "Price decrease",
        "No change"
    ])
    });

    export { ItemAnalysisSchema };
    ```

- to return a structured output containing
    - relevant snippet from post.txt
    - expected price change (enum: up | down | no change)
- when called with node it console logs these two parts of the structured output

### Flow

1. ~~something to check the rss page and flags changes~~
2. ~~something that downloads the new rss page content~~
3. ~~something that flags matches in the new rss page content against the items list~~
4. ~~presumably something that fetches the items list (keeping it up to date)~~
5. ~~some module that calls openai api~~
6. some higher level module that uses the openai api module, the new rss page content, and the matched items list and makes a series of calls (one per item) to get semantic analysis of the expected price changes, along with the text snippet that supports this (structured output)
7. some module that is capable of sending telegram messages through a bot
8. some higher level module that puts together the content of the openai response, semantic analysis, text snippets, etc, and sends it as a message using the telegram bot module (this is seemingly the highest level module and should be index.js)

- fix bug where itemMatcher matches incomplete item names