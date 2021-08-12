
# Homebridge Petwalk Plugin **BETA**

This is a basic plugin for Petwalk petwalk device, which can be found at [Petwalk](https://www.petwalk.at/dog_door_instead_of_pet_flap?___store=at_en&___from_store=at_de)

I have created this as I could not find another way to integrate the door to Homekit, but so far only a couple of hours effort so pretty basic.

This is based on the Petwalk **BETA** api documented here: [api](https://control.petwalk.solutions/doc/api/)

The api is currently quite limited, and I have not yet reached out to Petwalk to talk about assistance in enriching the capabilities. I am hoping in future updates Petwalk will offer more of the built in capabilities within the open API. The current API is awesome (and still in **BETA**), hoping Petwalk will continue to enrich it.

## Configuration Example


You need to enable the local API access for your Petwalk petdoor by following the instructions here:
[API Instructions](https://control.petwalk.solutions/doc/api/)


Homebridge config.json extract example:
...
  "platforms": [
    {
      "platform" : "homebridge-petwalk.PetwalkPlugin",
      "doors" : [
        {"name" : "Gizmo Flap",
        "ipAddress" : "192.168.xxx.xxx"}
      ]
    }
  ]






