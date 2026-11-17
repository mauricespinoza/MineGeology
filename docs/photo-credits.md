# Photo credits

Quebrada Los Litres uses **provisional** reference photos from Wikimedia Commons until the course's own photos replace them. They show a similar rock, not the scenario's place; the game says so under each photo, with its credit and licence.

All were reduced to at most 900 pixels and saved again without their metadata, so they carry no camera data or GPS position. The CC BY-SA photos are shared under the same licence as the originals.

| Unit | Rock | Photo | File | Author | Licence | Source |
| --- | --- | --- | --- | --- | --- | --- |
| u14 | andesita porfídica | muestra de mano | `photos/u14-mano.jpg` | James St. John | CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Andesite_2013.jpg) |
| u14 | andesita porfídica | corte delgado, nícoles paralelos | `photos/u14-corte.jpg` | Cheryl Cameron, USGS | dominio público | [Commons](https://commons.wikimedia.org/wiki/File:Rock_thin_section_andesite.jpg) |
| u03 | brecha volcánica y toba | muestra de mano | `photos/u03-mano.jpg` | James St. John | CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Volcanic_breccia.jpg) |
| u03 | brecha volcánica y toba | corte delgado, nícoles paralelos | `photos/u03-corte.jpg` | Omphacite (Wikimedia Commons) | dominio público | [Commons](https://commons.wikimedia.org/wiki/File:Tuff_shards.jpg) |
| u09 | arenisca calcárea y caliza | muestra de mano | `photos/u09-mano.jpg` | James St. John | CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Fossiliferous_limestone_(Columbus_Limestone,_Middle_Devonian;_glacial_clast_near_Reynoldsburg,_Ohio,_USA)_1.jpg) |
| u06 | andesita de grandes fenocristales (ocoíta) | muestra de mano | `photos/u06-mano.jpg` | Siim Sepp | CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:Plagioclase_porphyry.jpg) |
| u06 | andesita de grandes fenocristales (ocoíta) | corte delgado, nícoles cruzados | `photos/u06-corte.jpg` | Siim Sepp | CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:Andesite_pmg_ss_2006.jpg) |
| u11 | arenisca y conglomerado rojos | afloramiento | `photos/u11-afloramiento.jpg` | Gwen y James Anderson (geograph.org.uk) | CC BY-SA 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Close_up_of_conglomerate_and_red_sandstone,_Whiting_Ness_-_geograph.org.uk_-_496645.jpg) |
| u01 | andesita afanítica | muestra de mano | `photos/u01-mano.jpg` | Andrea R. Bair | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Andesite.jpg) |
| u01 | andesita afanítica | corte delgado, nícoles cruzados | `photos/u01-corte.jpg` | Darla Sondrol (GeoDIL) | CC0 | [Commons](https://commons.wikimedia.org/wiki/File:Hornblende_andesite_(GeoDIL_number_-_2634).jpg) |

Missing: thin sections of the marine beds (u09) and of the red beds (u11), and a hand sample of the red beds (only an outcrop photo).

## Replacing them with real photos

1. Put the JPEG files in `scenarios/<scenario>/photos/`.
2. List them under each unit in `scenario.yaml`, with `kind` (`hand_sample`, `thin_section_ppl`, `thin_section_xpl` or `outcrop`), `file`, `credit` and `licence` (and `source` if any).
3. Run `geomapper photos scenarios/<scenario> build/<bake>` (no need to bake again) and `geomapper publish --practice build/<bake> baked/<bake>`.

Keep photos below about 300 kB each, and strip GPS data from photos taken in the field.
