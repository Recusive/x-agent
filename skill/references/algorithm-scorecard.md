# Algorithm Scorecard — Full Reference

Copied from the x-content-creator skill for self-contained access.

## Step 1: Inventory Checks (Kill Conditions)

| Check | Pass Condition | If It Fails |
| --- | --- | --- |
| Text present | caption is not blank | dies in CoreDataHydrationFilter |
| Muted-token risk | no audience-muted tokens in hook | dies in MutedKeywordFilter |
| Video eligibility | original post and above duration threshold | loses VQV or the video lane |
| Retweet waste | not a plain retweet unless amplification is the goal | deduped against the original |
| Safety risk | no harassment, policy-edge bait, or gore/spam vibes | dies in VF, especially OON |

## Step 2: Score All 19 Actions

| Action | Ask This | Green If | Red If |
| --- | --- | --- | --- |
| `favorite_score` | Would a target reader want to keep this? | useful, resonant, or precise | generic or forgettable |
| `reply_score` | Does it invite a real response? | specific question or tradeoff | nothing to respond to |
| `repost_score` | Would someone rebroadcast this? | sharp takeaway or proof | too context-bound |
| `photo_expand_score` | Is the image worth zooming? | dense screenshot, chart, diff | no image or filler |
| `click_score` | Does the hook create curiosity? | strong first line with withheld value | no reason to tap |
| `profile_click_score` | Does this make the author interesting? | rare expertise or identity signal | anonymous-sounding |
| `vqv_score` | Would a viewer finish a qualifying clip? | original video with clear demo | non-qualifying or reply video |
| `share_score` | Would someone share broadly? | useful or surprising | too personal or vague |
| `share_via_dm_score` | Would someone send privately? | insider insight, tool rec | not worth private send |
| `share_via_copy_link_score` | Would someone paste this elsewhere? | reference post, benchmark | ephemeral chatter |
| `dwell_score` | Does it stop the scroll? | immediate tension or proof | weak hook |
| `quote_score` | Does it invite commentary? | strong claim with room to react | nothing to add |
| `quoted_click_score` | Would a quoter's audience need the original? | the context matters | no reason to click through |
| `follow_author_score` | Does it imply future value? | repeatable lane or authority | one-off thought |
| `not_interested_score` | Could this feel irrelevant? | tightly on niche | obvious mismatch or bait |
| `block_author_score` | Could this feel hostile? | critiques ideas, not people | personal attack |
| `mute_author_score` | Could this make them want less of you? | high signal, low annoyance | repetitive, promo-heavy |
| `report_score` | Could this look unsafe? | clearly safe | obvious risk |
| `dwell_time` | Is there enough substance? | depth, specifics, evidence | skimmed in seconds |

## Step 3: Structural Score

- Favorite lane: 15 points
- Dwell pair: 20 points total
- Share trio: 30 points total
- Conversation: 15 points
- Identity: 10 points
- Media: 10 points
- Risk: subtract up to 30 points

Green = full, Yellow = half, Red = zero. Risk signals: Green = 0 subtracted, Red = full subtraction.

## Step 4: Output Format

```
Algorithm Score: X/100

Greens: [what's working]
Yellows: [what needs slight improvement]
Reds: [what's failing]

Top 3 fixes: [specific actionable changes]
Top 3 risks: [specific negative-signal concerns]
```
