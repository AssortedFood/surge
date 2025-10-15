# TODO

- update all_items fetcher to update item prices using /latest
- fuzzy name matching
- add all_items.json filtering based on MARGIN_THRESHOLD

### allItemFetcher refactor

set interval threshold in .env for all items and prices to be cached (24h? 4h? 1h?)
on event pull all_items.json and \latest
map the results to an sql table (allows price tracking of market over time)
    for all_items we should consider only mapping the diff

### update itemMatcher

- ~~design thorough test suite with exceptions~~
- ~~produce comprehensive GENERIC_WORDS list~~
- ~~ensure matching prioritises longer strings first (define max string length)~~
- ~~ensure matching doesnt match the same text multiple times~~

### new marginThreshold module

takes an id and returns true or false if the item meets the marginThreshold
defined as a value in .env
calculated by looking at the difference between avg(highPrice, lowPrice) and some set % variance of avg(highPrice, lowPrice) e.g. avg - avg*1.05
if this value * buy limit isnt greater than MARGIN_THRESHOLD then return false, else return true
also set variance percentage in .env

**MARGIN_THRESHOLD**

Calculated by taking the avg(high,low) and multiply with buy limit
Represents an estimated p/l that could be made by a change in the given items price
Based on testing with lightbearer, tomato, rune arrow a trial value of 1,000,000 seems acceptable